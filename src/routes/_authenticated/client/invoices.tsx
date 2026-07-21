import { createFileRoute } from "@tanstack/react-router";
import { InvoicesTable } from "@/routes/_authenticated/admin/invoices";

export const Route = createFileRoute("/_authenticated/client/invoices")({
  head: () => ({
    meta: [
      { title: "My invoices — Kredix" },
      { name: "description", content: "Review and approve invoices, download PDFs." },
      { property: "og:title", content: "My invoices — Kredix" },
      { property: "og:description", content: "Review and approve invoices, download PDFs." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <InvoicesTable scope="client" />,
});
