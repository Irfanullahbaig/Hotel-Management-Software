/* eslint-disable no-console */
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { allPermissionCodes, DEFAULT_ROLES } from "@/server/auth/permissions";
import { bootstrapProperty } from "@/server/services/setup";
import { createReservation } from "@/server/services/reservations";
import { checkIn, nightAudit } from "@/server/services/frontdesk";
import { addDays, businessToday } from "@/lib/dates";
import { recordAttendance, requestLeave, decideLeave } from "@/server/services/hr";
import { seedOpsDemo } from "@/server/seed-ops";

export async function seedDatabase(prisma: PrismaClient) {
  // Default logins. All share one password; override it with SEED_DEFAULT_PASSWORD.
  const defaultPassword = process.env.SEED_DEFAULT_PASSWORD ?? "passpass@123";
  const withDemo = process.env.SEED_DEMO !== "false";

  // Permissions catalogue
  for (const p of allPermissionCodes()) {
    await prisma.permission.upsert({ where: { code: p.code }, update: { description: p.description }, create: p });
  }
  const perms = await prisma.permission.findMany();
  const permId = new Map(perms.map((p) => [p.code, p.id]));

  const org = (await prisma.organization.findFirst()) ?? (await prisma.organization.create({ data: { name: "Horizon Hospitality Group" } }));

  // System roles
  for (const r of DEFAULT_ROLES) {
    const role = await prisma.role.upsert({
      where: { organizationId_key: { organizationId: org.id, key: r.key } },
      update: { name: r.name, description: r.description },
      create: { organizationId: org.id, key: r.key, name: r.name, description: r.description, isSystem: true },
    });
    const codes = r.permissions === "*" ? perms.map((p) => p.code) : [...new Set(r.permissions)];
    for (const c of codes) {
      const id = permId.get(c);
      if (!id) throw new Error(`Unknown permission ${c} in role ${r.key}`);
      await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: id } }, update: {}, create: { roleId: role.id, permissionId: id } });
    }
  }

  const property =
    (await prisma.property.findFirst({ where: { organizationId: org.id } })) ??
    (await prisma.property.create({
      data: {
        organizationId: org.id, name: "Grand Horizon Hotel", code: "GHH", address: "1 Lakeside Avenue", phone: "+1 555 0100",
        email: "frontdesk@grandhorizon.example", currency: "USD", timeZone: "UTC", taxRate: 10, serviceChargeRate: 5,
        depositPercent: 20, cancellationPolicy: "Free cancellation up to 48 hours before arrival. Later cancellations forfeit the deposit.",
      },
    }));
  await prisma.$transaction((tx) => bootstrapProperty(tx, property.id));

  // Users
  const roleByKey = new Map((await prisma.role.findMany({ where: { organizationId: org.id } })).map((r) => [r.key, r]));
  const users: { email: string; name: string; role: string; superAdmin?: boolean }[] = [
    { email: "admin@hms.com", name: "System Administrator", role: "super_admin", superAdmin: true },
    { email: "gm@hms.com", name: "General Manager", role: "general_manager" },
    { email: "frontdesk@hms.com", name: "Receptionist", role: "receptionist" },
    { email: "housekeeping@hms.com", name: "Housekeeping Manager", role: "housekeeping_manager" },
    { email: "accounts@hms.com", name: "Accountant", role: "accountant" },
    { email: "hr@hms.com", name: "HR Manager", role: "hr_manager" },
    { email: "restaurant@hms.com", name: "Restaurant Manager", role: "restaurant_manager" },
    { email: "maintenance@hms.com", name: "Maintenance Manager", role: "maintenance_manager" },
    { email: "stores@hms.com", name: "Inventory Manager", role: "inventory_manager" },
    { email: "sales@hms.com", name: "Sales Manager", role: "sales_manager" },
  ];
  // One hash shared by every default login: bcrypt is slow on purpose, and this runs on each cold start of the demo.
  const passwordHash = await bcrypt.hash(defaultPassword, 12);
  for (const u of users) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    const user = existing ?? (await prisma.user.create({
      data: { organizationId: org.id, email: u.email, name: u.name, isSuperAdmin: !!u.superAdmin, passwordHash, mustChangePassword: false },
    }));
    await prisma.userProperty.upsert({ where: { userId_propertyId: { userId: user.id, propertyId: property.id } }, update: {}, create: { userId: user.id, propertyId: property.id } });
    const role = roleByKey.get(u.role)!;
    if (!(await prisma.userRole.findFirst({ where: { userId: user.id, roleId: role.id } }))) await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }

  // Room configuration (operational setup, not demo data)
  if ((await prisma.roomType.count({ where: { propertyId: property.id } })) === 0) {
    const amenityNames = ["Wi-Fi", "Air Conditioning", "Smart TV", "Minibar", "Safe", "Balcony", "Bathtub", "Lake View", "Coffee Machine", "Work Desk"];
    for (const name of amenityNames) await prisma.amenity.create({ data: { propertyId: property.id, name } });
    const am = new Map((await prisma.amenity.findMany({ where: { propertyId: property.id } })).map((a) => [a.name, a.id]));
    const types = [
      { code: "STD", name: "Standard Room", base: 120, bed: "1 Queen", size: 22, maxOcc: 2, maxA: 2, maxC: 1, extraA: 25, extraC: 10, am: ["Wi-Fi", "Air Conditioning", "Smart TV", "Work Desk"], floors: [1, 2], count: 8 },
      { code: "DLX", name: "Deluxe Room", base: 180, bed: "1 King", size: 30, maxOcc: 3, maxA: 3, maxC: 2, extraA: 35, extraC: 15, am: ["Wi-Fi", "Air Conditioning", "Smart TV", "Minibar", "Safe", "Coffee Machine"], floors: [2, 3], count: 6 },
      { code: "TWN", name: "Twin Room", base: 140, bed: "2 Single", size: 24, maxOcc: 2, maxA: 2, maxC: 1, extraA: 25, extraC: 10, am: ["Wi-Fi", "Air Conditioning", "Smart TV"], floors: [1], count: 4 },
      { code: "FAM", name: "Family Room", base: 240, bed: "1 King + 2 Single", size: 40, maxOcc: 5, maxA: 4, maxC: 3, extraA: 30, extraC: 15, am: ["Wi-Fi", "Air Conditioning", "Smart TV", "Minibar", "Bathtub"], floors: [3], count: 3 },
      { code: "STE", name: "Executive Suite", base: 380, bed: "1 King", size: 60, maxOcc: 3, maxA: 3, maxC: 2, extraA: 50, extraC: 20, am: amenityNames, floors: [4], count: 3 },
    ];
    for (const t of types) {
      const rt = await prisma.roomType.create({
        data: {
          propertyId: property.id, code: t.code, name: t.name, basePrice: t.base, bedConfiguration: t.bed, sizeSqm: t.size,
          baseOccupancy: 2, maxOccupancy: t.maxOcc, maxAdults: t.maxA, maxChildren: t.maxC, extraAdultCharge: t.extraA, extraChildCharge: t.extraC,
          amenities: { create: t.am.map((a) => ({ amenityId: am.get(a)! })) },
          rates: { create: [{ name: "Weekend rate", kind: "WEEKEND", daysOfWeek: [5, 6], price: Math.round(t.base * 1.15), priority: 10 }] },
        },
      });
      for (let i = 0; i < t.count; i++) {
        const floor = t.floors[i % t.floors.length];
        const existing = await prisma.room.count({ where: { propertyId: property.id, floor } });
        await prisma.room.create({ data: { propertyId: property.id, roomTypeId: rt.id, floor, number: `${floor}${String(existing + 1).padStart(2, "0")}`, building: "Main" } });
      }
    }
  }

  if (withDemo && (await prisma.reservation.count({ where: { propertyId: property.id } })) === 0) {
    await seedDemo(prisma, property.id, (await prisma.user.findUniqueOrThrow({ where: { email: "frontdesk@hms.com" } })).id);
  }
  if (withDemo && (await prisma.employee.count({ where: { propertyId: property.id } })) === 0) {
    await seedHrDemo(prisma, property.id, (await prisma.user.findUniqueOrThrow({ where: { email: "hr@hms.com" } })).id);
  }
  if (withDemo && (await prisma.outlet.count({ where: { propertyId: property.id } })) === 0) {
    await seedOpsDemo(prisma, property.id, (await prisma.user.findUniqueOrThrow({ where: { email: "gm@hms.com" } })).id);
  }
  console.log(`Seed complete. Default logins: ${users.map((u) => u.email).join(", ")}${process.env.SEED_DEFAULT_PASSWORD ? "" : ` / password ${defaultPassword}`}.`);
}

async function seedDemo(prisma: PrismaClient, propertyId: string, userId: string) {
  const today = businessToday("UTC");
  const actor = { userId, propertyId };
  const types = await prisma.roomType.findMany({ where: { propertyId } });
  const t = (code: string) => types.find((x) => x.code === code)!.id;
  const guests = [
    { firstName: "Amelia", lastName: "Hart", email: "amelia.hart@example.com", phone: "+44 7700 900111", nationality: "British", country: "United Kingdom" },
    { firstName: "Kenji", lastName: "Watanabe", email: "kenji.w@example.com", phone: "+81 90 1234 5678", nationality: "Japanese", country: "Japan" },
    { firstName: "Sofia", lastName: "Rossi", email: "sofia.rossi@example.com", phone: "+39 312 555 0199", nationality: "Italian", country: "Italy" },
    { firstName: "Omar", lastName: "Khan", email: "omar.khan@example.com", phone: "+92 300 555 0123", nationality: "Pakistani", country: "Pakistan" },
    { firstName: "Lena", lastName: "Fischer", email: "lena.fischer@example.com", phone: "+49 151 555 0142", nationality: "German", country: "Germany" },
  ];
  const plans = [
    { g: 0, type: "DLX", inOff: 0, nights: 3, src: "DIRECT", dep: 100, arrive: true },
    { g: 1, type: "STE", inOff: 0, nights: 2, src: "BOOKING_COM", dep: 0, arrive: false },
    { g: 2, type: "STD", inOff: 1, nights: 4, src: "WEBSITE", dep: 120, arrive: false },
    { g: 3, type: "FAM", inOff: 3, nights: 5, src: "PHONE", dep: 300, arrive: false },
    { g: 4, type: "TWN", inOff: 7, nights: 2, src: "EXPEDIA", dep: 0, arrive: false },
  ] as const;
  for (const [i, p] of plans.entries()) {
    await prisma.$transaction(async (tx) => {
      const g = guests[p.g];
      const res = await createReservation(tx, actor, {
        guest: { ...g, idType: "PASSPORT", idNumber: `P${100000 + i}` }, source: p.src, checkIn: addDays(today, p.inOff), checkOut: addDays(today, p.inOff + p.nights),
        rooms: [{ roomTypeId: t(p.type), adults: 2, children: 0 }], idempotencyKey: `demo-res-${i}`, today, isDemo: true,
        deposit: p.dep ? { amount: p.dep, method: "CARD" } : null, specialRequests: i === 0 ? "High floor, quiet room" : null,
      });
      await tx.guest.update({ where: { id: res.guestId }, data: { isDemo: true } });
      if (p.arrive) {
        const line = await tx.reservationRoom.findFirstOrThrow({ where: { reservationId: res.id } });
        const room = await tx.room.findFirstOrThrow({ where: { propertyId, roomTypeId: line.roomTypeId, occupancyStatus: "VACANT" } });
        await checkIn(tx, actor, { reservationId: res.id, lines: [{ lineId: line.id, roomId: room.id, adults: 2, children: 0 }], documentVerified: true, idempotencyKey: `demo-ci-${i}`, today });
        await nightAudit(tx, actor, today);
      }
    }, { timeout: 30000 });
  }
}

/** Demo staff linked to the demo logins, with two weeks of attendance and some leave. */
async function seedHrDemo(prisma: PrismaClient, propertyId: string, hrUserId: string) {
  const today = businessToday("UTC");
  const actor = { userId: hrUserId, propertyId };
  const dep = new Map((await prisma.department.findMany({ where: { propertyId } })).map((d) => [d.code, d.id]));
  const shift = new Map((await prisma.shift.findMany({ where: { propertyId } })).map((s) => [s.code, s]));
  const leave = new Map((await prisma.leaveType.findMany({ where: { propertyId } })).map((l) => [l.code, l.id]));
  const userId = async (email: string) => (await prisma.user.findUnique({ where: { email } }))?.id ?? null;
  const staff = [
    { first: "Grace", last: "Mensah", title: "General Manager", dep: "ADM", shift: "OFF", salary: 6500, months: 40, login: "gm@hms.com", gender: "Female" },
    { first: "Daniel", last: "Okafor", title: "Front Office Supervisor", dep: "FO", shift: "MOR", salary: 2800, months: 26, login: "frontdesk@hms.com", gender: "Male" },
    { first: "Priya", last: "Nair", title: "Receptionist", dep: "FO", shift: "EVE", salary: 2100, months: 14, gender: "Female" },
    { first: "Tomás", last: "Silva", title: "Night Auditor", dep: "FO", shift: "NGT", salary: 2300, months: 20, gender: "Male" },
    { first: "Mei", last: "Chen", title: "Executive Housekeeper", dep: "HK", shift: "MOR", salary: 2900, months: 33, login: "housekeeping@hms.com", gender: "Female" },
    { first: "Joseph", last: "Banda", title: "Room Attendant", dep: "HK", shift: "MOR", salary: 1600, months: 9, gender: "Male" },
    { first: "Fatima", last: "Zahra", title: "Room Attendant", dep: "HK", shift: "MOR", salary: 1600, months: 5, gender: "Female" },
    { first: "Luca", last: "Bianchi", title: "Maintenance Technician", dep: "MNT", shift: "MOR", salary: 2200, months: 18, gender: "Male" },
    { first: "Sarah", last: "Collins", title: "Accountant", dep: "FIN", shift: "OFF", salary: 3400, months: 22, login: "accounts@hms.com", gender: "Female" },
    { first: "Aisha", last: "Rahman", title: "HR Manager", dep: "HR", shift: "OFF", salary: 3600, months: 30, login: "hr@hms.com", gender: "Female" },
  ];
  const ids: string[] = [];
  for (const [i, s] of staff.entries()) {
    const hire = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - s.months, 1 + (i % 20)));
    const e = await prisma.employee.create({
      data: {
        propertyId, employeeNo: `EMP-${String(i + 1).padStart(4, "0")}`, firstName: s.first, lastName: s.last, jobTitle: s.title, gender: s.gender,
        email: `${s.first.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}.${s.last.toLowerCase()}@example.com`, phone: `+1 555 01${String(10 + i)}`,
        departmentId: dep.get(s.dep), defaultShiftId: shift.get(s.shift)!.id, baseSalary: s.salary, hireDate: hire,
        userId: s.login ? await userId(s.login) : null, bankName: "Lakeside Bank", bankAccount: `GB00LAKE${String(40000000 + i * 7919)}`, isDemo: true,
      },
    });
    ids.push(e.id);
  }
  await prisma.sequence.upsert({ where: { propertyId_key: { propertyId, key: "EMP" } }, update: { value: staff.length }, create: { propertyId, key: "EMP", value: staff.length } });

  // Two weeks of attendance (weekdays for office staff, every day for operations), with a few late arrivals and overtime.
  for (let back = 14; back >= 1; back--) {
    const date = addDays(today, -back);
    const weekend = [0, 6].includes(date.getUTCDay());
    await prisma.$transaction(async (tx) => {
      for (const [i, s] of staff.entries()) {
        const sh = shift.get(s.shift)!;
        if (s.shift === "OFF" && weekend) { await recordAttendance(tx, actor, { employeeId: ids[i], date, status: "DAY_OFF", clockIn: null, clockOut: null }); continue; }
        if ((i + back) % 7 === 0) { await recordAttendance(tx, actor, { employeeId: ids[i], date, status: "DAY_OFF", clockIn: null, clockOut: null }); continue; }
        if (i === 7 && back === 3) { await recordAttendance(tx, actor, { employeeId: ids[i], date, status: "ON_LEAVE", clockIn: null, clockOut: null }); continue; }
        if (i === 6 && back === 4) { await recordAttendance(tx, actor, { employeeId: ids[i], date, status: "ABSENT", clockIn: null, clockOut: null, note: "No call, no show" }); continue; }
        const lateBy = (i * 3 + back) % 11 === 0 ? 25 : (i + back) % 5;
        const extra = (i + back) % 6 === 0 ? 90 : (i + back) % 4;
        await recordAttendance(tx, actor, { employeeId: ids[i], date, clockIn: (sh.startMinute + lateBy) % 1440, clockOut: (sh.endMinute + extra) % 1440 });
      }
    }, { timeout: 30000 });
  }
  // Leave: one approved annual leave next week, one pending sick leave, one approved unpaid day last week.
  const hkUserId = await userId("housekeeping@hms.com");
  await prisma.$transaction(async (tx) => {
    await requestLeave(tx, actor, { employeeId: ids[2], leaveTypeId: leave.get("AL")!, startDate: addDays(today, 7), endDate: addDays(today, 11), reason: "Family visit", autoApprove: true });
    await requestLeave(tx, { userId: hkUserId, propertyId }, { employeeId: ids[5], leaveTypeId: leave.get("SL")!, startDate: addDays(today, 1), endDate: addDays(today, 2), reason: "Dental surgery" });
    const unpaid = await requestLeave(tx, actor, { employeeId: ids[7], leaveTypeId: leave.get("UL")!, startDate: addDays(today, -3), endDate: addDays(today, -3), reason: "Personal matter" });
    await decideLeave(tx, actor, { requestId: unpaid.id, approve: true, note: "Approved, unpaid" });
  }, { timeout: 30000 });
}
