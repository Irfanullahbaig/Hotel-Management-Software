-- CreateEnum
CREATE TYPE "public"."LostFoundStatus" AS ENUM ('STORED', 'RETURNED', 'DISPOSED');

-- CreateEnum
CREATE TYPE "public"."ServiceOrderStatus" AS ENUM ('REQUESTED', 'IN_PROGRESS', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."PosOrderStatus" AS ENUM ('OPEN', 'SETTLED', 'VOID');

-- CreateEnum
CREATE TYPE "public"."KitchenStatus" AS ENUM ('NEW', 'PREPARING', 'READY', 'SERVED', 'VOID');

-- CreateEnum
CREATE TYPE "public"."PurchaseRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ORDERED');

-- CreateEnum
CREATE TYPE "public"."PurchaseOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."BillStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID');

-- CreateEnum
CREATE TYPE "public"."EventStatus" AS ENUM ('TENTATIVE', 'CONFIRMED', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "public"."MaintenanceRequest" ADD COLUMN     "assigneeId" TEXT,
ADD COLUMN     "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "costEntryId" TEXT,
ADD COLUMN     "costPaidBy" TEXT,
ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "number" TEXT,
ADD COLUMN     "resolution" TEXT,
ADD COLUMN     "scheduleId" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."Property" ADD COLUMN     "bookingEngineEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "booksClosedThrough" DATE,
ADD COLUMN     "loyaltyEarnRate" DECIMAL(8,3) NOT NULL DEFAULT 1,
ADD COLUMN     "loyaltyPointValue" DECIMAL(8,4) NOT NULL DEFAULT 0.01;

-- CreateTable
CREATE TABLE "public"."MaintenanceSchedule" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "roomId" TEXT,
    "equipment" TEXT,
    "everyDays" INTEGER NOT NULL,
    "nextDue" DATE NOT NULL,
    "priority" "public"."Priority" NOT NULL DEFAULT 'NORMAL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LostFoundItem" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "roomId" TEXT,
    "foundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "foundBy" TEXT,
    "status" "public"."LostFoundStatus" NOT NULL DEFAULT 'STORED',
    "returnedTo" TEXT,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "LostFoundItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ServiceItem" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "revenueAccount" TEXT NOT NULL DEFAULT '4600',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ServiceOrder" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "serviceItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reservationId" TEXT,
    "guestName" TEXT NOT NULL,
    "roomNumber" TEXT,
    "chargeTo" TEXT NOT NULL,
    "paymentMethod" "public"."PaymentMethod",
    "status" "public"."ServiceOrderStatus" NOT NULL DEFAULT 'REQUESTED',
    "scheduledFor" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Outlet" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'RESTAURANT',
    "revenueAccount" TEXT NOT NULL DEFAULT '4100',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Outlet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DiningTable" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 4,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DiningTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MenuCategory" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MenuCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MenuItem" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(14,2) NOT NULL,
    "station" TEXT NOT NULL DEFAULT 'KITCHEN',
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PosOrder" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "tableId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'DINE_IN',
    "reservationId" TEXT,
    "guestName" TEXT,
    "roomNumber" TEXT,
    "covers" INTEGER NOT NULL DEFAULT 1,
    "status" "public"."PosOrderStatus" NOT NULL DEFAULT 'OPEN',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "serviceCharge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "settledTo" TEXT,
    "paymentMethod" "public"."PaymentMethod",
    "journalEntryId" TEXT,
    "voidReason" TEXT,
    "openedById" TEXT,
    "settledById" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "PosOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PosOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "station" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "status" "public"."KitchenStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),

    CONSTRAINT "PosOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Expense" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "account" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidBy" TEXT NOT NULL,
    "supplierId" TEXT,
    "reference" TEXT,
    "journalEntryId" TEXT,
    "billId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Budget" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "account" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StockLocation" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "StockLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryItem" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "reorderLevel" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "avgCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "expenseAccount" TEXT NOT NULL DEFAULT '5900',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StockLevel" (
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("itemId","locationId")
);

-- CreateTable
CREATE TABLE "public"."InventoryTxn" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "totalCost" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "department" TEXT,
    "account" TEXT,
    "reason" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "journalEntryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryTxn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Supplier" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "taxId" TEXT,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchaseRequest" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "reason" TEXT,
    "department" TEXT,
    "status" "public"."PurchaseRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "purchaseOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchaseOrder" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "public"."PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "orderDate" DATE NOT NULL,
    "expectedDate" DATE,
    "notes" TEXT,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "receivedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GoodsReceipt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "supplierRef" TEXT,
    "notes" TEXT,
    "total" DECIMAL(14,2) NOT NULL,
    "receivedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "poLineId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupplierBill" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "receiptId" TEXT,
    "supplierRef" TEXT,
    "description" TEXT NOT NULL,
    "billDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "public"."BillStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupplierPayment" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "public"."PaymentMethod" NOT NULL,
    "reference" TEXT,
    "journalEntryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LoyaltyAccount" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "lifetimePoints" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LoyaltyTxn" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyTxn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Coupon" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "percentOff" DECIMAL(5,2),
    "amountOff" DECIMAL(14,2),
    "validFrom" DATE,
    "validTo" DATE,
    "minNights" INTEGER NOT NULL DEFAULT 1,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Campaign" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "couponCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "delivery" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GuestFeedback" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "guestId" TEXT,
    "reservationId" TEXT,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rating" INTEGER,
    "comments" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EventVenue" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "hourlyRate" DECIMAL(14,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "EventVenue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EventBooking" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "date" DATE NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "attendees" INTEGER NOT NULL,
    "status" "public"."EventStatus" NOT NULL DEFAULT 'TENTATIVE',
    "notes" TEXT,
    "folioId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EventItem" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,2) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "revenueAccount" TEXT NOT NULL DEFAULT '4400',
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "EventItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ChannelConnection" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "hotelCode" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ChannelRoomMapping" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "channelRoomCode" TEXT NOT NULL,
    "ratePlanCode" TEXT,
    "markupPercent" DECIMAL(6,2) NOT NULL DEFAULT 0,

    CONSTRAINT "ChannelRoomMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ChannelSyncLog" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CompetitorRate" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "competitor" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "roomLabel" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceItem_propertyId_name_key" ON "public"."ServiceItem"("propertyId", "name");

-- CreateIndex
CREATE INDEX "ServiceOrder_propertyId_status_idx" ON "public"."ServiceOrder"("propertyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceOrder_propertyId_number_key" ON "public"."ServiceOrder"("propertyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Outlet_propertyId_code_key" ON "public"."Outlet"("propertyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "DiningTable_outletId_name_key" ON "public"."DiningTable"("outletId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "MenuCategory_propertyId_name_key" ON "public"."MenuCategory"("propertyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItem_categoryId_name_key" ON "public"."MenuItem"("categoryId", "name");

-- CreateIndex
CREATE INDEX "PosOrder_propertyId_status_idx" ON "public"."PosOrder"("propertyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PosOrder_propertyId_number_key" ON "public"."PosOrder"("propertyId", "number");

-- CreateIndex
CREATE INDEX "PosOrderItem_status_idx" ON "public"."PosOrderItem"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_billId_key" ON "public"."Expense"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_propertyId_number_key" ON "public"."Expense"("propertyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_propertyId_year_account_key" ON "public"."Budget"("propertyId", "year", "account");

-- CreateIndex
CREATE UNIQUE INDEX "StockLocation_propertyId_code_key" ON "public"."StockLocation"("propertyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_propertyId_sku_key" ON "public"."InventoryItem"("propertyId", "sku");

-- CreateIndex
CREATE INDEX "InventoryTxn_itemId_createdAt_idx" ON "public"."InventoryTxn"("itemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTxn_propertyId_number_key" ON "public"."InventoryTxn"("propertyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_propertyId_name_key" ON "public"."Supplier"("propertyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_propertyId_number_key" ON "public"."PurchaseOrder"("propertyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierBill_receiptId_key" ON "public"."SupplierBill"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierBill_propertyId_number_key" ON "public"."SupplierBill"("propertyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyAccount_guestId_key" ON "public"."LoyaltyAccount"("guestId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyAccount_number_key" ON "public"."LoyaltyAccount"("number");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyTxn_accountId_sourceType_sourceId_key" ON "public"."LoyaltyTxn"("accountId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_propertyId_code_key" ON "public"."Coupon"("propertyId", "code");

-- CreateIndex
CREATE INDEX "GuestFeedback_propertyId_createdAt_idx" ON "public"."GuestFeedback"("propertyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventVenue_propertyId_name_key" ON "public"."EventVenue"("propertyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "EventBooking_folioId_key" ON "public"."EventBooking"("folioId");

-- CreateIndex
CREATE INDEX "EventBooking_venueId_date_idx" ON "public"."EventBooking"("venueId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "EventBooking_propertyId_number_key" ON "public"."EventBooking"("propertyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConnection_propertyId_channel_key" ON "public"."ChannelConnection"("propertyId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelRoomMapping_connectionId_roomTypeId_key" ON "public"."ChannelRoomMapping"("connectionId", "roomTypeId");

-- CreateIndex
CREATE INDEX "ChannelSyncLog_connectionId_createdAt_idx" ON "public"."ChannelSyncLog"("connectionId", "createdAt");

-- CreateIndex
CREATE INDEX "CompetitorRate_propertyId_date_idx" ON "public"."CompetitorRate"("propertyId", "date");

-- AddForeignKey
ALTER TABLE "public"."MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "public"."MaintenanceSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LostFoundItem" ADD CONSTRAINT "LostFoundItem_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ServiceItem" ADD CONSTRAINT "ServiceItem_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ServiceOrder" ADD CONSTRAINT "ServiceOrder_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ServiceOrder" ADD CONSTRAINT "ServiceOrder_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "public"."ServiceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Outlet" ADD CONSTRAINT "Outlet_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DiningTable" ADD CONSTRAINT "DiningTable_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "public"."Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MenuCategory" ADD CONSTRAINT "MenuCategory_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MenuItem" ADD CONSTRAINT "MenuItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."MenuCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PosOrder" ADD CONSTRAINT "PosOrder_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PosOrder" ADD CONSTRAINT "PosOrder_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "public"."Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PosOrder" ADD CONSTRAINT "PosOrder_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "public"."DiningTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PosOrderItem" ADD CONSTRAINT "PosOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."PosOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PosOrderItem" ADD CONSTRAINT "PosOrderItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "public"."MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Expense" ADD CONSTRAINT "Expense_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Expense" ADD CONSTRAINT "Expense_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "public"."Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Budget" ADD CONSTRAINT "Budget_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockLocation" ADD CONSTRAINT "StockLocation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryItem" ADD CONSTRAINT "InventoryItem_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockLevel" ADD CONSTRAINT "StockLevel_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockLevel" ADD CONSTRAINT "StockLevel_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryTxn" ADD CONSTRAINT "InventoryTxn_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryTxn" ADD CONSTRAINT "InventoryTxn_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryTxn" ADD CONSTRAINT "InventoryTxn_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "public"."StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryTxn" ADD CONSTRAINT "InventoryTxn_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "public"."StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Supplier" ADD CONSTRAINT "Supplier_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "public"."Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "public"."GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "public"."PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierBill" ADD CONSTRAINT "SupplierBill_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierBill" ADD CONSTRAINT "SupplierBill_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "public"."Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierBill" ADD CONSTRAINT "SupplierBill_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "public"."GoodsReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierPayment" ADD CONSTRAINT "SupplierPayment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "public"."SupplierBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "public"."Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LoyaltyTxn" ADD CONSTRAINT "LoyaltyTxn_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."LoyaltyAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Coupon" ADD CONSTRAINT "Coupon_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Campaign" ADD CONSTRAINT "Campaign_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GuestFeedback" ADD CONSTRAINT "GuestFeedback_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GuestFeedback" ADD CONSTRAINT "GuestFeedback_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "public"."Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EventVenue" ADD CONSTRAINT "EventVenue_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EventBooking" ADD CONSTRAINT "EventBooking_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EventBooking" ADD CONSTRAINT "EventBooking_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "public"."EventVenue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EventBooking" ADD CONSTRAINT "EventBooking_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "public"."Folio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EventItem" ADD CONSTRAINT "EventItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."EventBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ChannelConnection" ADD CONSTRAINT "ChannelConnection_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ChannelRoomMapping" ADD CONSTRAINT "ChannelRoomMapping_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "public"."ChannelConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ChannelSyncLog" ADD CONSTRAINT "ChannelSyncLog_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "public"."ChannelConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CompetitorRate" ADD CONSTRAINT "CompetitorRate_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Integrity rules enforced by the database ───
-- Closed accounting periods: no journal entry may be dated on or before the property's close date.
CREATE OR REPLACE FUNCTION forbid_closed_period() RETURNS trigger AS $$
DECLARE closed DATE;
BEGIN
  SELECT "booksClosedThrough" INTO closed FROM "Property" WHERE id = NEW."propertyId";
  IF closed IS NOT NULL AND NEW."date" <= closed THEN
    RAISE EXCEPTION 'Books are closed through %; this entry is dated %', closed, NEW."date";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER journal_entries_open_period BEFORE INSERT ON "JournalEntry"
  FOR EACH ROW EXECUTE FUNCTION forbid_closed_period();

ALTER TABLE "StockLevel" ADD CONSTRAINT "stock_levels_non_negative" CHECK ("quantity" >= 0);
ALTER TABLE "InventoryTxn" ADD CONSTRAINT "inventory_txns_positive" CHECK ("quantity" > 0 AND "unitCost" >= 0);
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "po_lines_quantities" CHECK ("quantity" > 0 AND "unitCost" >= 0 AND "receivedQty" >= 0 AND "receivedQty" <= "quantity");
ALTER TABLE "SupplierBill" ADD CONSTRAINT "supplier_bills_paid" CHECK ("amount" > 0 AND "paid" >= 0 AND "paid" <= "amount");
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "supplier_payments_positive" CHECK ("amount" > 0);
ALTER TABLE "Expense" ADD CONSTRAINT "expenses_positive" CHECK ("amount" > 0);
ALTER TABLE "PosOrderItem" ADD CONSTRAINT "pos_items_positive" CHECK ("quantity" > 0 AND "unitPrice" >= 0);
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "service_orders_positive" CHECK ("quantity" > 0 AND "amount" >= 0);
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "loyalty_points_non_negative" CHECK ("points" >= 0);
ALTER TABLE "EventBooking" ADD CONSTRAINT "event_times" CHECK ("endMinute" > "startMinute" AND "startMinute" >= 0 AND "endMinute" <= 1440 AND "attendees" > 0);
-- A venue cannot hold two active events whose times overlap on the same day.
ALTER TABLE "EventBooking"
  ADD CONSTRAINT "event_bookings_no_overlap"
  EXCLUDE USING gist ("venueId" WITH =, "date" WITH =, int4range("startMinute", "endMinute") WITH &&)
  WHERE ("status" IN ('TENTATIVE', 'CONFIRMED'));
