import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { D, ZERO } from "@/lib/money";
import { addDays, diffNights, eachNight, toDateOnlyString } from "@/lib/dates";
import { displayStatus } from "./rooms";

const num = (v: Prisma.Decimal.Value | null | undefined) => Number(D(v).toFixed(2));

/** Revenue/expense per account type for a date range, straight from the ledger. */
async function ledgerTotals(tx: Tx, propertyId: string, from: Date, to: Date) {
  const rows = await tx.$queryRaw<{ code: string; type: string; net: string }[]>`
    SELECT a.code, a.type::text, COALESCE(SUM(l.credit - l.debit), 0)::text AS net
    FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" JOIN "Account" a ON a.id = l."accountId"
    WHERE e."propertyId" = ${propertyId} AND e.date BETWEEN ${from} AND ${to} AND a.type IN ('INCOME','EXPENSE')
    GROUP BY a.code, a.type`;
  const revenue = rows.filter((r) => r.type === "INCOME").reduce((a, r) => a.plus(r.net), ZERO);
  const expenses = rows.filter((r) => r.type === "EXPENSE").reduce((a, r) => a.minus(r.net), ZERO);
  const room = rows.filter((r) => r.code === "4000").reduce((a, r) => a.plus(r.net), ZERO);
  return { revenue, expenses, room, byCode: rows };
}

export async function getDashboard(tx: Tx, propertyId: string, today: Date, range: { from: Date; to: Date }) {
  const rooms = await tx.room.findMany({ where: { propertyId, isActive: true }, include: { roomType: true } });
  const arrivalsToday = await tx.reservationRoom.findMany({ where: { reservation: { propertyId }, checkIn: today, status: { in: ["RESERVED", "CHECKED_IN"] } }, select: { roomId: true, status: true } });
  const arrivingRoomIds = new Set(arrivalsToday.filter((a) => a.status === "RESERVED" && a.roomId).map((a) => a.roomId));
  const statusCounts: Record<string, number> = {};
  for (const r of rooms) {
    const s = displayStatus(r, arrivingRoomIds.has(r.id));
    statusCounts[s] = (statusCounts[s] ?? 0) + 1;
  }
  const maintenance = (statusCounts.UNDER_MAINTENANCE ?? 0) + (statusCounts.OUT_OF_SERVICE ?? 0) + (statusCounts.BLOCKED ?? 0);
  const dirty = (statusCounts.DIRTY ?? 0) + (statusCounts.CLEANING_ASSIGNED ?? 0) + (statusCounts.CLEANING_IN_PROGRESS ?? 0);

  const departuresToday = await tx.reservationRoom.count({ where: { reservation: { propertyId }, checkOut: today, status: { in: ["CHECKED_IN", "CHECKED_OUT"] } } });
  const departuresPending = await tx.reservationRoom.count({ where: { reservation: { propertyId }, checkOut: { lte: today }, status: "CHECKED_IN" } });
  const inHouse = await tx.reservationRoom.aggregate({ where: { reservation: { propertyId }, status: "CHECKED_IN" }, _sum: { adults: true, children: true } });

  const resWhere = { propertyId, createdAt: { gte: range.from, lt: addDays(range.to, 1) } };
  const [totalRes, pendingRes, cancelledRes] = await Promise.all([
    tx.reservation.count({ where: resWhere }),
    tx.reservation.count({ where: { ...resWhere, status: "PENDING" } }),
    tx.reservation.count({ where: { ...resWhere, status: { in: ["CANCELLED", "NO_SHOW"] } } }),
  ]);

  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const [todayL, monthL, rangeL] = await Promise.all([
    ledgerTotals(tx, propertyId, today, today),
    ledgerTotals(tx, propertyId, monthStart, today),
    ledgerTotals(tx, propertyId, range.from, range.to),
  ]);
  const ar = await tx.$queryRaw<{ net: string }[]>`
    SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS net FROM "JournalLine" l JOIN "Account" a ON a.id = l."accountId"
    WHERE a."propertyId" = ${propertyId} AND a.code = '1100'`;

  // Occupancy: room-nights sold (non-cancelled stays) over sellable room-nights in the range.
  const nightsInRange = diffNights(range.from, addDays(range.to, 1));
  const availableRoomNights = rooms.length * nightsInRange;
  const soldNights = await tx.reservationNight.findMany({
    where: { date: { gte: range.from, lte: range.to }, reservationRoom: { reservation: { propertyId }, status: { in: ["RESERVED", "CHECKED_IN", "CHECKED_OUT"] } } },
    select: { date: true, rate: true, extraCharge: true, postedAt: true, reservationRoom: { select: { roomTypeId: true, roomId: true, roomType: { select: { name: true } }, room: { select: { number: true } } } } },
  });
  const sold = soldNights.length;
  const occupancy = availableRoomNights ? sold / availableRoomNights : 0;
  const postedNights = soldNights.filter((n) => n.postedAt);
  const adr = postedNights.length ? rangeL.room.dividedBy(postedNights.length) : ZERO;
  const revpar = availableRoomNights ? rangeL.room.dividedBy(availableRoomNights) : ZERO;

  // Trends
  const days = eachNight(range.from, addDays(range.to, 1)).slice(-92);
  const revByDay = await tx.$queryRaw<{ d: Date; net: string }[]>`
    SELECT e.date AS d, COALESCE(SUM(l.credit - l.debit), 0)::text AS net
    FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" JOIN "Account" a ON a.id = l."accountId"
    WHERE e."propertyId" = ${propertyId} AND e.date BETWEEN ${range.from} AND ${range.to} AND a.type = 'INCOME'
    GROUP BY e.date`;
  const revMap = new Map(revByDay.map((r) => [toDateOnlyString(r.d), Number(r.net)]));
  const occMap = new Map<string, number>();
  for (const n of soldNights) occMap.set(toDateOnlyString(n.date), (occMap.get(toDateOnlyString(n.date)) ?? 0) + 1);
  const trend = days.map((d) => {
    const k = toDateOnlyString(d);
    return { date: k.slice(5), revenue: revMap.get(k) ?? 0, occupied: occMap.get(k) ?? 0, available: rooms.length - (occMap.get(k) ?? 0) };
  });

  const sources = await tx.reservation.groupBy({ by: ["source"], where: { ...resWhere, status: { notIn: ["CANCELLED", "NO_SHOW"] } }, _count: true });
  const byType = new Map<string, number>();
  for (const n of postedNights) byType.set(n.reservationRoom.roomType.name, (byType.get(n.reservationRoom.roomType.name) ?? 0) + num(D(n.rate).plus(n.extraCharge)));
  const byRoom = new Map<string, { nights: number; revenue: number }>();
  for (const n of soldNights) {
    if (!n.reservationRoom.room) continue;
    const k = n.reservationRoom.room.number;
    const cur = byRoom.get(k) ?? { nights: 0, revenue: 0 };
    byRoom.set(k, { nights: cur.nights + 1, revenue: cur.revenue + num(D(n.rate).plus(n.extraCharge)) });
  }
  const payments = await tx.payment.groupBy({ by: ["method", "kind"], where: { propertyId, receivedAt: { gte: range.from, lt: addDays(range.to, 1) } }, _sum: { amount: true } });
  const payByMethod = new Map<string, number>();
  for (const p of payments) payByMethod.set(p.method, (payByMethod.get(p.method) ?? 0) + (p.kind === "REFUND" ? -num(p._sum.amount) : num(p._sum.amount)));

  const nationalities = await tx.$queryRaw<{ n: string | null; c: bigint }[]>`
    SELECT g.nationality AS n, COUNT(DISTINCT g.id) AS c FROM "Reservation" r JOIN "Guest" g ON g.id = r."guestId"
    WHERE r."propertyId" = ${propertyId} AND r."checkIn" <= ${range.to} AND r."checkOut" > ${range.from} AND r.status NOT IN ('CANCELLED','NO_SHOW')
    GROUP BY g.nationality ORDER BY c DESC LIMIT 8`;
  const movement = await tx.$queryRaw<{ d: Date; arrivals: bigint; departures: bigint }[]>`
    SELECT d::date AS d,
      (SELECT COUNT(*) FROM "ReservationRoom" rr JOIN "Reservation" r ON r.id = rr."reservationId" WHERE r."propertyId" = ${propertyId} AND rr."checkIn" = d::date AND rr.status IN ('RESERVED','CHECKED_IN','CHECKED_OUT')) AS arrivals,
      (SELECT COUNT(*) FROM "ReservationRoom" rr JOIN "Reservation" r ON r.id = rr."reservationId" WHERE r."propertyId" = ${propertyId} AND rr."checkOut" = d::date AND rr.status IN ('RESERVED','CHECKED_IN','CHECKED_OUT')) AS departures
    FROM generate_series(${days[0] ?? range.from}::date, ${range.to}::date, '1 day') d`;
  const cancellations = await tx.$queryRaw<{ d: Date; c: bigint }[]>`
    SELECT date_trunc('day', "cancelledAt")::date AS d, COUNT(*) AS c FROM "Reservation"
    WHERE "propertyId" = ${propertyId} AND "cancelledAt" >= ${range.from} AND "cancelledAt" < ${addDays(range.to, 1)} GROUP BY 1 ORDER BY 1`;

  return {
    rooms: {
      total: rooms.length, available: statusCounts.AVAILABLE ?? 0, occupied: statusCounts.OCCUPIED ?? 0, reserved: statusCounts.RESERVED ?? 0,
      dirty, maintenance, inspectionPending: statusCounts.CLEAN ?? 0, counts: statusCounts,
    },
    frontdesk: {
      arrivalsToday: arrivalsToday.length, arrivalsPending: arrivalsToday.filter((a) => a.status === "RESERVED").length,
      departuresToday, departuresPending, currentGuests: (inHouse._sum.adults ?? 0) + (inHouse._sum.children ?? 0),
    },
    reservations: { total: totalRes, pending: pendingRes, cancelled: cancelledRes },
    finance: {
      todayRevenue: num(todayL.revenue), monthRevenue: num(monthL.revenue), rangeRevenue: num(rangeL.revenue), expenses: num(rangeL.expenses),
      netProfit: num(rangeL.revenue.minus(rangeL.expenses)), outstanding: num(ar[0]?.net),
    },
    kpi: { occupancy, adr: num(adr), revpar: num(revpar), soldNights: sold, availableRoomNights },
    charts: {
      trend,
      sources: sources.map((s) => ({ name: s.source.replaceAll("_", " ").toLowerCase(), value: s._count })),
      revenueByType: [...byType.entries()].map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 })).sort((a, b) => b.value - a.value),
      revenueByDepartment: rangeL.byCode.filter((r) => r.type === "INCOME" && Number(r.net) !== 0).map((r) => ({ code: r.code, value: Number(r.net) })),
      paymentMethods: [...payByMethod.entries()].map(([name, value]) => ({ name: name.replaceAll("_", " ").toLowerCase(), value })),
      nationalities: nationalities.map((n) => ({ name: n.n ?? "Unknown", value: Number(n.c) })),
      movement: movement.map((m) => ({ date: toDateOnlyString(m.d).slice(5), arrivals: Number(m.arrivals), departures: Number(m.departures) })),
      cancellations: cancellations.map((c) => ({ date: toDateOnlyString(c.d).slice(5), value: Number(c.c) })),
      topRooms: [...byRoom.entries()].map(([room, v]) => ({ room, ...v })).sort((a, b) => b.revenue - a.revenue).slice(0, 8),
    },
  };
}
