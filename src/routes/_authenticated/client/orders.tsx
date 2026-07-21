import { createFileRoute } from "@tanstack/react-router";
import { OrdersTable } from "@/routes/_authenticated/admin/orders";

export const Route = createFileRoute("/_authenticated/client/orders")({
  head: () => ({
    meta: [
      { title: "My orders — Kredix" },
      { name: "description", content: "Review orders sent by your account manager." },
      { property: "og:title", content: "My orders — Kredix" },
      { property: "og:description", content: "Review orders sent by your account manager." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <OrdersTable scope="client" />,
});
