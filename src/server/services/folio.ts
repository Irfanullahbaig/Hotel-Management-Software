import { Prisma, type FolioTxnType, type PaymentKind, type PaymentMethod } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { D, ZERO, round2, sum } from "@/lib/money";
import { ACC, cashAccountFor, postJournal } from "./ledger";
import { chargeBreakdown, discountBreakdown } from "./pricing";
import { BusinessError, assert, claimIdempotencyKey, completeIdempotencyKey, nextNumber, pad, type Actor } from "./common";

async function getPropertyRates(tx: Tx, propertyId: string) {
  return tx.property.findUniqueOrThrow({ where: { id: propertyId }, select: { serviceChargeRate: true, taxRate: true, code: true } });
}

export async function openFolio(tx: Tx, actor: Actor, reservationId: string | null) {
  const n = await nextNumber(tx, actor.propertyId, "FOLIO");
  return tx.folio.create({ data: { propertyId: actor.propertyId, reservationId, number: `F-${pad(n)}` } });
}

export async function folioBalance(tx: Tx, folioId: string) {
  const agg = await tx.folioTransaction.aggregate({ where: { folioId }, _sum: { amount: true } });
  return D(agg._sum.amount);
}

/**
 * Post a revenue charge (with service charge and tax) to a guest folio.
 * Ledger: Dr Accounts Receivable / Cr revenue, Cr service charge revenue, Cr taxes payable.
 * Idempotent on (sourceType, sourceId).
 */
export async function postCharge(
  tx: Tx,
  actor: Actor,
  input: {
    folioId: string;
    type: FolioTxnType;
    description: string;
    amount: Prisma.Decimal.Value;
    serviceDate: Date;
    revenueAccount: string;
    sourceType: string;
    sourceId: string;
    applyServiceAndTax?: boolean;
  },
) {
  const folio = await tx.folio.findUniqueOrThrow({ where: { id: input.folioId } });
  assert(folio.propertyId === actor.propertyId, "Folio belongs to another property.");
  const dup = await tx.folioTransaction.findFirst({ where: { folioId: folio.id, sourceType: input.sourceType, sourceId: input.sourceId } });
  if (dup) return null;
  const rates = await getPropertyRates(tx, actor.propertyId);
  const b = input.applyServiceAndTax === false
    ? { base: round2(input.amount), service: ZERO, tax: ZERO, total: round2(input.amount) }
    : chargeBreakdown(input.amount, rates.serviceChargeRate, rates.taxRate);
  assert(b.base.greaterThan(0), "Charge amount must be greater than zero.");

  const je = await postJournal(tx, actor, {
    date: input.serviceDate,
    memo: `${input.description} (folio ${folio.number})`,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    lines: [
      { account: ACC.AR, debit: b.total },
      { account: input.revenueAccount, credit: b.base },
      { account: ACC.SERVICE_CHARGE_REVENUE, credit: b.service },
      { account: ACC.TAXES_PAYABLE, credit: b.tax },
    ],
  });
  const common = { folioId: folio.id, serviceDate: input.serviceDate, sourceType: input.sourceType, sourceId: input.sourceId, journalEntryId: je.id, createdById: actor.userId };
  const main = await tx.folioTransaction.create({ data: { ...common, type: input.type, description: input.description, amount: b.base } });
  if (!b.service.isZero()) await tx.folioTransaction.create({ data: { ...common, type: "SERVICE_CHARGE", description: `Service charge — ${input.description}`, amount: b.service } });
  if (!b.tax.isZero()) await tx.folioTransaction.create({ data: { ...common, type: "TAX", description: `Tax — ${input.description}`, amount: b.tax } });
  return main;
}

/** Post one reservation night (room rate + extra-person charge) as earned room revenue. */
export async function postNight(tx: Tx, actor: Actor, nightId: string) {
  const night = await tx.reservationNight.findUniqueOrThrow({
    where: { id: nightId },
    include: { reservationRoom: { include: { room: true, roomType: true, reservation: { include: { folio: true } } } } },
  });
  if (night.postedAt) return;
  const line = night.reservationRoom;
  const folio = line.reservation.folio;
  if (!folio) throw new BusinessError("Reservation has no folio.");
  const label = `Room ${line.room?.number ?? line.roomType.name} — ${night.date.toISOString().slice(0, 10)}`;
  const txn = await postCharge(tx, actor, {
    folioId: folio.id, type: "ROOM_CHARGE", description: label, amount: night.rate, serviceDate: night.date,
    revenueAccount: ACC.ROOM_REVENUE, sourceType: "NIGHT", sourceId: night.id,
  });
  if (!D(night.extraCharge).isZero()) {
    await postCharge(tx, actor, {
      folioId: folio.id, type: "EXTRA_PERSON", description: `Extra guest charge — ${label}`, amount: night.extraCharge,
      serviceDate: night.date, revenueAccount: ACC.ROOM_REVENUE, sourceType: "NIGHT_EXTRA", sourceId: night.id,
    });
  }
  await tx.reservationNight.update({ where: { id: night.id }, data: { postedAt: new Date(), folioTransactionId: txn?.id } });
}

/**
 * Apply a discount to the folio. Reverses the base plus the service charge and tax levied on it.
 * Ledger: Dr Discounts Allowed, Dr Service Charge Revenue, Dr Taxes Payable / Cr Accounts Receivable.
 */
export async function postDiscount(tx: Tx, actor: Actor, folioId: string, amount: Prisma.Decimal.Value, date: Date, sourceId: string, reason: string) {
  const rates = await getPropertyRates(tx, actor.propertyId);
  const b = discountBreakdown(amount, rates);
  if (b.base.lessThanOrEqualTo(0)) return;
  const dup = await tx.folioTransaction.findFirst({ where: { folioId, sourceType: "DISCOUNT", sourceId } });
  if (dup) return;
  const je = await postJournal(tx, actor, {
    date, memo: `Discount: ${reason}`, sourceType: "DISCOUNT", sourceId,
    lines: [
      { account: ACC.DISCOUNTS, debit: b.base },
      { account: ACC.SERVICE_CHARGE_REVENUE, debit: b.service },
      { account: ACC.TAXES_PAYABLE, debit: b.tax },
      { account: ACC.AR, credit: b.total },
    ],
  });
  await tx.folioTransaction.create({
    data: { folioId, type: "DISCOUNT", description: `Discount — ${reason}`, amount: b.total.negated(), serviceDate: date, sourceType: "DISCOUNT", sourceId, journalEntryId: je.id, createdById: actor.userId },
  });
}

/**
 * Record money received from (or refunded to) a guest.
 *  - DEPOSIT (before check-in):    Dr Cash/Bank / Cr Guest Deposits
 *  - SETTLEMENT (in-house/at c/o): Dr Cash/Bank / Cr Accounts Receivable
 *  - REFUND of a deposit:          Dr Guest Deposits / Cr Cash/Bank
 *  - REFUND of an overpayment:     Dr Accounts Receivable / Cr Cash/Bank
 * Idempotent on idempotencyKey.
 */
export async function recordPayment(
  tx: Tx,
  actor: Actor,
  input: {
    folioId: string;
    kind: PaymentKind;
    method: PaymentMethod;
    amount: Prisma.Decimal.Value;
    reference?: string | null;
    notes?: string | null;
    idempotencyKey: string;
    refundOf?: "DEPOSIT" | "RECEIVABLE";
    date: Date;
  },
) {
  const amount = round2(input.amount);
  assert(amount.greaterThan(0), "Payment amount must be greater than zero.");
  const claim = await claimIdempotencyKey(tx, input.idempotencyKey, "payment");
  if (!claim.fresh) return tx.payment.findUniqueOrThrow({ where: { idempotencyKey: input.idempotencyKey } });

  const folio = await tx.folio.findUniqueOrThrow({ where: { id: input.folioId } });
  assert(folio.propertyId === actor.propertyId, "Folio belongs to another property.");
  const cash = cashAccountFor(input.method);

  if (input.kind === "REFUND") {
    const refundable = input.refundOf === "DEPOSIT" ? await unappliedDeposits(tx, folio.id) : (await folioBalance(tx, folio.id)).negated();
    assert(amount.lessThanOrEqualTo(refundable), `Refund cannot exceed ${refundable.toFixed(2)}.`);
  }

  const n = await nextNumber(tx, actor.propertyId, "RCPT");
  const payment = await tx.payment.create({
    data: {
      propertyId: actor.propertyId, folioId: folio.id, receiptNumber: `RC-${pad(n)}`, kind: input.kind, method: input.method,
      amount, reference: input.reference || null, notes: input.notes || null, idempotencyKey: input.idempotencyKey,
      receivedById: actor.userId, appliedAt: input.kind === "REFUND" && input.refundOf !== "DEPOSIT" ? new Date() : null,
    },
  });
  const lines =
    input.kind === "DEPOSIT"
      ? [{ account: cash, debit: amount }, { account: ACC.GUEST_DEPOSITS, credit: amount }]
      : input.kind === "SETTLEMENT"
        ? [{ account: cash, debit: amount }, { account: ACC.AR, credit: amount }]
        : [{ account: input.refundOf === "DEPOSIT" ? ACC.GUEST_DEPOSITS : ACC.AR, debit: amount }, { account: cash, credit: amount }];
  const je = await postJournal(tx, actor, {
    date: input.date, memo: `${input.kind.toLowerCase()} ${payment.receiptNumber} (${input.method.toLowerCase()})`,
    sourceType: "PAYMENT", sourceId: payment.id, lines,
  });
  await tx.payment.update({ where: { id: payment.id }, data: { journalEntryId: je.id } });
  await tx.folioTransaction.create({
    data: {
      folioId: folio.id, type: input.kind === "REFUND" ? "REFUND" : "PAYMENT",
      description: `${input.kind === "DEPOSIT" ? "Advance deposit" : input.kind === "REFUND" ? "Refund" : "Payment"} ${payment.receiptNumber} — ${input.method.replace("_", " ").toLowerCase()}`,
      amount: input.kind === "REFUND" ? amount : amount.negated(),
      serviceDate: input.date, sourceType: "PAYMENT", sourceId: payment.id, journalEntryId: je.id, createdById: actor.userId,
    },
  });
  await completeIdempotencyKey(tx, input.idempotencyKey, payment.id);
  return payment;
}

/** Deposits still held as a liability (not yet transferred to the guest ledger), net of deposit refunds. */
export async function unappliedDeposits(tx: Tx, folioId: string) {
  const pays = await tx.payment.findMany({ where: { folioId, appliedAt: null, kind: { in: ["DEPOSIT", "REFUND"] } } });
  return sum(pays.map((p) => (p.kind === "DEPOSIT" ? D(p.amount) : D(p.amount).negated())));
}

/** Move held deposits onto the guest ledger: Dr Guest Deposits / Cr Accounts Receivable. */
export async function applyDeposits(tx: Tx, actor: Actor, folioId: string, date: Date) {
  const net = await unappliedDeposits(tx, folioId);
  const pays = await tx.payment.findMany({ where: { folioId, appliedAt: null, kind: { in: ["DEPOSIT", "REFUND"] } } });
  if (pays.length === 0) return ZERO;
  if (net.greaterThan(0)) {
    const count = await tx.journalEntry.count({ where: { propertyId: actor.propertyId, sourceType: "DEPOSIT_TRANSFER", sourceId: folioId } });
    await postJournal(tx, actor, {
      date, memo: "Transfer guest deposits to guest ledger", sourceType: "DEPOSIT_TRANSFER", sourceId: folioId, purpose: `t${count + 1}`,
      lines: [{ account: ACC.GUEST_DEPOSITS, debit: net }, { account: ACC.AR, credit: net }],
    });
  }
  await tx.payment.updateMany({ where: { id: { in: pays.map((p) => p.id) } }, data: { appliedAt: new Date() } });
  return net;
}

export async function generateInvoice(tx: Tx, actor: Actor, folioId: string, billTo: string) {
  const folio = await tx.folio.findUniqueOrThrow({ where: { id: folioId }, include: { transactions: { orderBy: [{ serviceDate: "asc" }, { createdAt: "asc" }] } } });
  const charges = folio.transactions.filter((t) => !["PAYMENT", "REFUND"].includes(t.type));
  const pick = (types: FolioTxnType[]) => sum(charges.filter((t) => types.includes(t.type)).map((t) => t.amount));
  const subtotal = pick(["ROOM_CHARGE", "EXTRA_PERSON", "SERVICE", "RESTAURANT", "ADJUSTMENT"]);
  const discount = pick(["DISCOUNT"]).negated();
  const serviceCharge = pick(["SERVICE_CHARGE"]);
  const tax = pick(["TAX"]);
  const total = sum(charges.map((t) => t.amount));
  const paid = sum(folio.transactions.filter((t) => ["PAYMENT", "REFUND"].includes(t.type)).map((t) => t.amount)).negated();
  const n = await nextNumber(tx, actor.propertyId, "INV");
  return tx.invoice.create({
    data: {
      propertyId: actor.propertyId, folioId, number: `INV-${pad(n)}`, subtotal, discount, serviceCharge, tax, total, paid,
      balance: total.minus(paid), billTo,
      items: { create: charges.map((t) => ({ date: t.serviceDate, description: t.description, type: t.type, amount: t.amount })) },
    },
  });
}
