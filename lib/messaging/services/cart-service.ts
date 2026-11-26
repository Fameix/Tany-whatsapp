import { createPendingPayment, getPayment } from "@/lib/messaging/services/payment-service";
import { emitEntityEvent, writeEntityEvent } from "@/lib/automations/events";
import "server-only";
import { createHash } from "node:crypto";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { databaseMode } from "@/lib/data/repository";
import { getCatalogItem } from "@/lib/messaging/services/catalog-service";
import {
  mutateDocument,
  documentId,
  money,
  serverTimestamp,
} from "@/lib/messaging/services/shared";
import type {
  Order,
  OrderItem,
  LocationData,
} from "@/lib/messaging/domain-types";
import { getRuntimeRecordById, mutateRuntimeRecordById, postgresRuntimeMode } from "@/lib/messaging/services/postgres-runtime-records";
export async function changeCart(input: {
  businessId: string;
  customerPhone: string;
  orderId: string;
  eventId: string;
  selections?: { productId: string; quantity: number }[];
  mode: "add" | "set" | "replace" | "reprice" | "remove";
  removeId?: string;
}) {
  if (postgresRuntimeMode()) return (await mutateRuntimeRecordById<Order & Record<string, unknown>>("orders", documentId(input.orderId), async order => {
    if (order.businessId !== input.businessId || order.customerPhone !== input.customerPhone || order.vertical !== "eats") throw new Error("Cart unavailable");
    const previousEvents = Array.isArray(order.cartEventIds) ? order.cartEventIds as string[] : [];
    if (previousEvents.includes(input.eventId)) return order;
    if (!["draft", "pending_confirmation"].includes(order.status) || order.paymentId) throw new Error("This order is no longer editable");
    const quantities = new Map((input.mode === "replace" ? [] : order.items).map(item => [item.id, item.quantity]));
    if (input.mode === "remove" && input.removeId) quantities.delete(input.removeId);
    for (const selection of input.selections ?? []) {
      if (!Number.isSafeInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > 99) throw new Error("Quantity must be 1-99");
      const key = documentId(selection.productId);
      quantities.set(key, (input.mode === "add" ? quantities.get(key) ?? 0 : 0) + selection.quantity);
    }
    if (quantities.size > 30) throw new Error("Cart supports up to 30 items");
    const items: OrderItem[] = [];
    for (const [id, quantity] of quantities) {
      if (input.mode === "remove" && order.items.some(item => item.id === id)) { items.push(order.items.find(item => item.id === id)!); continue; }
      const product = await getCatalogItem(input.businessId, id);
      if (!product || product.type !== "product" || !product.available || product.metadata?.stock === 0 || !Number.isFinite(product.price) || product.price <= 0 || quantity > 99 || (typeof product.metadata?.stock === "number" && quantity > product.metadata.stock)) throw new Error("A selected item is unavailable. Check the menu and cart.");
      items.push({ id, name: product.name, quantity, unitPrice: money(product.price), totalPrice: money(quantity * product.price), metadata: {} });
    }
    const subtotal = money(items.reduce((sum, item) => sum + item.totalPrice, 0));
    return { ...order, items, subtotal, total: subtotal, deliveryFee: 0, discount: 0, cartEventIds: [...previousEvents, input.eventId], updatedAt: Timestamp.now() };
  })).current;
  const ref = adminDb.collection("orders").doc(documentId(input.orderId));
  const eventRef = adminDb.collection("cart_events").doc(
    createHash("sha256")
      .update(JSON.stringify([input.businessId, input.orderId, input.eventId]))
      .digest("hex"),
  );
  return adminDb.runTransaction(async (tx) => {
    const order = (await tx.get(ref)).data() as Omit<Order, "id"> | undefined;
    const event = (await tx.get(eventRef)).data();
    if (
      !order ||
      order.businessId !== input.businessId ||
      order.customerPhone !== input.customerPhone ||
      order.vertical !== "eats"
    )
      throw new Error("Cart unavailable");
    if (event) return { ...order, id: ref.id } as Order;
    if (
      !["draft", "pending_confirmation"].includes(order.status) ||
      order.paymentId
    )
      throw new Error("This order is no longer editable");
    const quantities = new Map(
      (input.mode === "replace" ? [] : order.items).map((item) => [
        item.id,
        item.quantity,
      ]),
    );
    if (input.mode === "remove" && input.removeId)
      quantities.delete(input.removeId);
    for (const selection of input.selections ?? []) {
      if (
        !Number.isSafeInteger(selection.quantity) ||
        selection.quantity < 1 ||
        selection.quantity > 99
      )
        throw new Error("Quantity must be 1-99");
      quantities.set(
        documentId(selection.productId),
        (input.mode === "add"
          ? (quantities.get(selection.productId) ?? 0)
          : 0) + selection.quantity,
      );
    }
    if (quantities.size > 30) throw new Error("Cart supports up to 30 items");
    const items: OrderItem[] = [];
    for (const [id, quantity] of quantities) {
      if (input.mode === "remove") {
        const existing = order.items.find((i) => i.id === id);
        if (existing) {
          items.push(existing);
          continue;
        }
      }

      const product = (databaseMode() === "postgres" || databaseMode() === "dual-write")
        ? await getCatalogItem(input.businessId, id)
        : (
        await tx.get(
          adminDb
            .collection("businesses")
            .doc(documentId(input.businessId))
            .collection("catalog")
            .doc(documentId(id)),
        )
      ).data();
      if (
        !product ||
        product.type !== "product" ||
        !product.available ||
        product.metadata?.stock === 0 ||
        !Number.isFinite(product.price) ||
        product.price <= 0 ||
        quantity > 99 ||
        (typeof product.metadata?.stock === "number" &&
          quantity > product.metadata.stock)
      )
        throw new Error(
          "A selected item is unavailable. Check the menu and cart.",
        );
      items.push({
        id,
        name: product.name,
        quantity,
        unitPrice: money(product.price),
        totalPrice: money(quantity * product.price),
        metadata: {},
      });
    }
    const subtotal = money(
      items.reduce((sum, item) => sum + item.totalPrice, 0),
    );
    const data = {
      items,
      subtotal,
      total: subtotal,
      deliveryFee: 0,
      discount: 0,
      updatedAt: serverTimestamp(),
    };
    tx.update(ref, data);
    tx.create(eventRef, {
      businessId: input.businessId,
      orderId: ref.id,
      createdAt: serverTimestamp(),
    });
    return { ...order, ...data, id: ref.id } as Order;
  });
}

/** Freeze the exact reviewed basket atomically; concurrent cart changes cannot alter a payable order. */
export async function confirmCartOrder(order: Order): Promise<Order> {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(order.items))
    .digest("hex");
  const payment = await createPendingPayment({
    businessId: order.businessId,
    customerPhone: order.customerPhone,
    amount: order.total,
    referenceType: "order",
    referenceId: order.id,
    idempotencyKey: `eats-cart:${order.id}:${fingerprint}`,
  });
  if (postgresRuntimeMode()) {
    const current = await getRuntimeRecordById<Order & Record<string, unknown>>("orders", documentId(order.id));
    const paid = await getPayment(payment.id);
    if (!current || current.businessId !== order.businessId || current.customerPhone !== order.customerPhone || current.vertical !== "eats" || !current.location) throw new Error("Order unavailable");
    if (current.status === "awaiting_payment" && current.paymentId === payment.id) return current;
    if (current.status !== "pending_confirmation" || current.paymentId || current.total !== order.total || JSON.stringify(current.items) !== JSON.stringify(order.items) || !paid || paid.status !== "pending" || paid.amount !== order.total || paid.businessId !== order.businessId || paid.customerPhone !== order.customerPhone || paid.referenceId !== order.id || paid.referenceType !== "order") throw new Error("Cart changed. Review before confirming again.");
    for (const item of current.items) { const product = await getCatalogItem(order.businessId, item.id); if (product?.type !== "product" || !product.available || product.metadata?.stock === 0 || product.price !== item.unitPrice || (typeof product.metadata?.stock === "number" && item.quantity > product.metadata.stock)) throw new Error("Menu changed. Review before confirming."); }
    const result = await mutateRuntimeRecordById<Order & Record<string, unknown>>("orders", documentId(order.id), row => {
      if (row.status !== current.status || row.total !== current.total || JSON.stringify(row.items) !== JSON.stringify(current.items)) throw new Error("Cart changed. Review before confirming again.");
      return { ...row, status: "awaiting_payment", paymentId: payment.id, automationRevision: (row.automationRevision ?? 0) + 1, updatedAt: Timestamp.now() };
    });
    await emitEntityEvent("order.status.changed", result.current, { previousStatus: current.status });
    return result.current;
  }
  const ref = adminDb.collection("orders").doc(documentId(order.id));
  return adminDb.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data() as Omit<Order, "id"> | undefined;
    const paid = (
      await tx.get(adminDb.collection("payments").doc(payment.id))
    ).data();
    if (
      !current ||
      current.businessId !== order.businessId ||
      current.customerPhone !== order.customerPhone ||
      current.vertical !== "eats" ||
      !current.location
    )
      throw new Error("Order unavailable");
    if (
      current.status === "awaiting_payment" &&
      current.paymentId === payment.id
    )
      return { ...current, id: ref.id };
    if (
      current.status !== "pending_confirmation" ||
      current.paymentId ||
      current.total !== order.total ||
      JSON.stringify(current.items) !== JSON.stringify(order.items) ||
      !paid ||
      paid.status !== "pending" ||
      paid.amount !== order.total ||
      paid.businessId !== order.businessId ||
      paid.customerPhone !== order.customerPhone ||
      paid.referenceId !== order.id ||
      paid.referenceType !== "order"
    )
      throw new Error("Cart changed. Review before confirming again.");
    for (const item of current.items) {
      const product = (databaseMode() === "postgres" || databaseMode() === "dual-write")
        ? await getCatalogItem(order.businessId, item.id)
        : (
        await tx.get(
          adminDb
            .collection("businesses")
            .doc(order.businessId)
            .collection("catalog")
            .doc(documentId(item.id)),
        )
      ).data();
      if (
        product?.type !== "product" ||
        !product?.available ||
        product.metadata?.stock === 0 ||
        product.price !== item.unitPrice ||
        (typeof product.metadata?.stock === "number" &&
          item.quantity > product.metadata.stock)
      )
        throw new Error("Menu changed. Review before confirming.");
    }
    const data = {
      status: "awaiting_payment" as const,
      paymentId: payment.id,
      automationRevision: (current.automationRevision ?? 0) + 1,
      updatedAt: serverTimestamp(),
    };
    await writeEntityEvent(
      tx,
      "order.status.changed",
      { ...current, ...data, id: ref.id },
      { previousStatus: current.status },
    );
    tx.update(ref, data);
    return { ...current, ...data, id: ref.id };
  });
}

export async function setCartDelivery(
  businessId: string,
  customerPhone: string,
  orderId: string,
  location: LocationData,
) {
  if (postgresRuntimeMode()) {
    const result = await mutateRuntimeRecordById<Order & Record<string, unknown>>("orders", documentId(orderId), current => {
      if (current.businessId !== businessId || current.customerPhone !== customerPhone || current.vertical !== "eats" || current.paymentId || !["draft", "pending_confirmation"].includes(current.status)) throw new Error("This order is no longer editable");
      return { ...current, location, status: "pending_confirmation", automationRevision: (current.automationRevision ?? 0) + 1, updatedAt: Timestamp.now() };
    });
    if (result.previous.status !== result.current.status) await emitEntityEvent("order.status.changed", result.current, { previousStatus: result.previous.status });
    return result.current;
  }
  return mutateDocument<Order>(
    adminDb.collection("orders").doc(documentId(orderId)),
    (current) => {
      if (
        current.businessId !== businessId ||
        current.customerPhone !== customerPhone ||
        current.vertical !== "eats" ||
        current.paymentId ||
        !["draft", "pending_confirmation"].includes(current.status)
      )
        throw new Error("This order is no longer editable");
      return {
        location,
        status: "pending_confirmation",
        automationRevision: (current.automationRevision ?? 0) + 1,
      };
    },
    async (tx, previous, updated) => {
      if (previous.status !== updated.status)
        await writeEntityEvent(tx, "order.status.changed", updated, {
          previousStatus: previous.status,
        });
    },
  );
}
