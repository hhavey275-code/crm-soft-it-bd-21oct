import { useParams } from "@/lib/router-compat";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Printer, Pencil, Check } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

export default function InvoicePage() {
  const { requestId } = useParams<{ requestId: string }>();
  const { isAdmin } = useAuth();
  const [editMode, setEditMode] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["invoice", requestId],
    queryFn: async () => {
      const { data: invoice, error: invErr } = await (supabase as any)
        .from("invoices")
        .select("*")
        .eq("top_up_request_id", requestId)
        .single();
      if (invErr) throw invErr;

      const { data: request } = await supabase
        .from("top_up_requests")
        .select("*")
        .eq("id", requestId!)
        .single();

      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", invoice.user_id)
        .single();

      return { invoice, request, profile };
    },
    enabled: !!requestId,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!data?.invoice) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Invoice not found</p>
      </div>
    );
  }

  const { invoice, request, profile } = data;
  const accent = "#0066CC";
  const accentLight = "#E8F0FE";

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .invoice-page { box-shadow: none !important; margin: 0 !important; }
        }
        @page { size: A4; margin: 0; }
      `}</style>

      <div className="min-h-screen bg-muted/30 p-4 md:p-8 flex flex-col items-center">
        <div className="no-print flex justify-end w-full max-w-[210mm] mb-4">
          {isAdmin && (
            <Button
              variant={editMode ? "default" : "outline"}
              onClick={() => setEditMode((v) => !v)}
              className="gap-2 mr-2"
            >
              {editMode ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
              {editMode ? "Done Editing" : "Edit"}
            </Button>
          )}
          <Button onClick={() => window.print()} className="gap-2">
            <Printer className="h-4 w-4" />
            Print / Download PDF
          </Button>
        </div>

        {/* A4 container: 210mm x 297mm */}
        <div
          contentEditable={editMode}
          suppressContentEditableWarning
          className="invoice-page bg-white text-black shadow-xl relative overflow-hidden"
          style={{
            width: "210mm",
            minHeight: "297mm",
            padding: "0",
            fontFamily: "'Inter', Arial, sans-serif",
            outline: editMode ? "2px dashed #0066CC" : "none",
          }}
        >
          {/* Top accent bar */}
          <div style={{ height: "6px", background: accent }} />

          {/* Left accent stripe */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: "6px",
              background: accent,
            }}
          />

          <div style={{ padding: "32px 40px 24px 46px" }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <img
                  src="/images/company-logo.png"
                  alt="SOFT IT BD"
                  style={{ height: "52px", width: "52px", objectFit: "contain" }}
                />
                <div>
                  <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#111", margin: 0, lineHeight: 1.2 }}>
                    SOFT IT BD
                  </h1>
                  <p style={{ fontSize: "10px", color: "#888", margin: "2px 0 0", letterSpacing: "0.5px" }}>
                    DIGITAL MARKETING SOLUTIONS
                  </p>
                </div>
              </div>
              <h2
                style={{
                  fontSize: "36px",
                  fontWeight: 800,
                  color: accent,
                  margin: 0,
                  letterSpacing: "3px",
                }}
              >
                INVOICE
              </h2>
            </div>

            {/* Divider */}
            <div style={{ height: "2px", background: accent, marginBottom: "24px" }} />

            {/* Invoice To + Invoice Details */}
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "32px" }}>
              <div>
                <h3 style={{ fontSize: "12px", fontWeight: 700, color: accent, textTransform: "uppercase", marginBottom: "6px", letterSpacing: "1px" }}>
                  Invoice to:
                </h3>
                <p style={{ fontSize: "16px", fontWeight: 600, color: "#111", margin: "0 0 4px" }}>
                  {profile?.company || profile?.full_name || "—"}
                </p>
                {profile?.business_address && (
                  <p style={{ fontSize: "12px", color: "#666", margin: "0 0 2px" }}>{profile.business_address}</p>
                )}
                {profile?.phone && (
                  <p style={{ fontSize: "12px", color: "#666", margin: "0 0 2px" }}>Phone: {profile.phone}</p>
                )}
                {profile?.email && (
                  <p style={{ fontSize: "12px", color: "#666", margin: 0 }}>Email: {profile.email}</p>
                )}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ display: "flex", gap: "24px", justifyContent: "flex-end", marginBottom: "4px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "#555" }}>Invoice#</span>
                  <span style={{ fontSize: "12px", color: "#333", minWidth: "100px", textAlign: "left" }}>
                    {invoice.invoice_number}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "24px", justifyContent: "flex-end" }}>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "#555" }}>Date</span>
                  <span style={{ fontSize: "12px", color: "#333", minWidth: "100px", textAlign: "left" }}>
                    {format(new Date(invoice.created_at), "dd / MM / yyyy")}
                  </span>
                </div>
              </div>
            </div>

            {/* Table */}
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "24px" }}>
              <thead>
                <tr style={{ background: accent }}>
                  <th style={{ color: "white", fontSize: "11px", fontWeight: 600, padding: "10px 12px", textAlign: "left", width: "40px" }}>
                    SL.
                  </th>
                  <th style={{ color: "white", fontSize: "11px", fontWeight: 600, padding: "10px 12px", textAlign: "left" }}>
                    Item Description
                  </th>
                  <th style={{ color: "white", fontSize: "11px", fontWeight: 600, padding: "10px 12px", textAlign: "right" }}>
                    Rate
                  </th>
                  <th style={{ color: "white", fontSize: "11px", fontWeight: 600, padding: "10px 12px", textAlign: "right", width: "60px" }}>
                    Qty.
                  </th>
                  <th style={{ color: "white", fontSize: "11px", fontWeight: 600, padding: "10px 12px", textAlign: "right" }}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const usdQty = Number(invoice.amount) || 0;
                  const rate = Number(invoice.usd_rate) || 0;
                  const bdtTotal = Number(invoice.bdt_amount) || usdQty * rate;

                  // Prefer stored split (kafela/holy gift after upgrade); fall back to derivation.
                  const storedSheet = Number((request as any)?.sheet_bill_bdt ?? 0);
                  const storedWalletDue = Number((request as any)?.wallet_due_paid_bdt ?? 0);
                  const hasStored = storedSheet > 0.5 || storedWalletDue > 0.5;

                  const sheetBill = hasStored ? storedSheet : Math.max(0, bdtTotal - usdQty * rate);
                  const walletDue = hasStored ? storedWalletDue : 0;
                  const hasSheet = sheetBill > 0.5;
                  const hasWalletDue = walletDue > 0.5;

                  // Real remainder credited as NEW wallet funds (Meta Ads) =
                  // total - wallet-due-cleared - sheet. Only show Meta row when this > 0.
                  const remainderBdt = Math.max(0, bdtTotal - walletDue - sheetBill);
                  const remainderUsd = rate > 0 ? remainderBdt / rate : 0;
                  const walletDueUsd = rate > 0 ? walletDue / rate : 0;

                  const rows: Array<{ desc: string; rate: string; qty: string; total: number }> = [];
                  if (hasWalletDue) {
                    rows.push({
                      desc: "Wallet Due Payment",
                      rate: `৳${rate.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
                      qty: walletDueUsd.toLocaleString(undefined, { minimumFractionDigits: 2 }),
                      total: walletDue,
                    });
                  }
                  if (hasSheet) {
                    rows.push({ desc: "Sheet Bill Adjustment", rate: "—", qty: "—", total: sheetBill });
                  }
                  if (remainderBdt > 0.5 && remainderUsd > 0) {
                    rows.push({
                      desc: "Meta Advertising",
                      rate: `৳${rate.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
                      qty: remainderUsd.toLocaleString(undefined, { minimumFractionDigits: 2 }),
                      total: remainderBdt,
                    });
                  } else if (!hasStored && usdQty > 0) {
                    // Legacy invoices (no stored split, no sheet/walletDue) — show full meta row.
                    rows.push({
                      desc: "Meta Advertising",
                      rate: `৳${rate.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
                      qty: usdQty.toLocaleString(undefined, { minimumFractionDigits: 2 }),
                      total: usdQty * rate,
                    });
                  }
                  const padCount = Math.max(0, 4 - rows.length);
                  return (
                    <>
                      {rows.map((r, idx) => (
                        <tr key={idx} style={{ borderBottom: "1px solid #eee" }}>
                          <td style={{ padding: "12px", fontSize: "13px", color: "#444" }}>{idx + 1}</td>
                          <td style={{ padding: "12px", fontSize: "13px", color: "#333", fontWeight: 500 }}>{r.desc}</td>
                          <td style={{ padding: "12px", fontSize: "13px", color: "#444", textAlign: "right" }}>{r.rate}</td>
                          <td style={{ padding: "12px", fontSize: "13px", color: "#444", textAlign: "right" }}>{r.qty}</td>
                          <td style={{ padding: "12px", fontSize: "13px", color: "#111", fontWeight: 600, textAlign: "right" }}>
                            ৳{r.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                      {[...Array(padCount)].map((_, i) => (
                        <tr key={`pad-${i}`} style={{ borderBottom: "1px solid #eee" }}>
                          <td style={{ padding: "12px", fontSize: "13px", color: "#ccc" }}>&nbsp;</td>
                          <td style={{ padding: "12px" }}>&nbsp;</td>
                          <td style={{ padding: "12px" }}>&nbsp;</td>
                          <td style={{ padding: "12px" }}>&nbsp;</td>
                          <td style={{ padding: "12px" }}>&nbsp;</td>
                        </tr>
                      ))}
                    </>
                  );
                })()}
              </tbody>

            </table>

            {/* Bottom section: Thank you + Totals */}
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "28px" }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: "13px", fontWeight: 600, color: "#333", marginBottom: "16px" }}>
                  Thank you for your business
                </p>

                <div style={{ marginBottom: "12px" }}>
                  <h4 style={{ fontSize: "11px", fontWeight: 700, color: "#333", textTransform: "uppercase", marginBottom: "4px" }}>
                    Terms & Conditions:
                  </h4>
                  <p style={{ fontSize: "10px", color: "#888", lineHeight: 1.5, maxWidth: "280px" }}>
                    All top-up amounts are non-refundable once processed. Rates are fixed at the time of invoice generation.
                  </p>
                </div>

                <div>
                  <h4 style={{ fontSize: "11px", fontWeight: 700, color: "#333", textTransform: "uppercase", marginBottom: "4px" }}>
                    Payment Info:
                  </h4>
                  <p style={{ fontSize: "10px", color: "#888", lineHeight: 1.6 }}>
                    Reference: {request?.payment_reference || "—"}
                  </p>
                </div>
              </div>

              <div style={{ width: "240px" }}>
                {(() => {
                  const usdQty = Number(invoice.amount) || 0;
                  const rate = Number(invoice.usd_rate) || 0;
                  const bdtTotal = Number(invoice.bdt_amount) || usdQty * rate;
                  return (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "13px" }}>
                        <span style={{ color: "#666" }}>Sub Total:</span>
                        <span style={{ color: "#333", fontWeight: 500 }}>
                          ৳{bdtTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "13px", borderBottom: "1px solid #ddd" }}>
                        <span style={{ color: "#666" }}>Tax:</span>
                        <span style={{ color: "#333", fontWeight: 500 }}>0.00%</span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          padding: "10px 12px",
                          marginTop: "6px",
                          background: accentLight,
                          border: `2px solid ${accent}`,
                          borderRadius: "4px",
                        }}
                      >
                        <span style={{ fontSize: "14px", fontWeight: 700, color: accent }}>Total:</span>
                        <span style={{ fontSize: "16px", fontWeight: 700, color: accent }}>
                          ৳{bdtTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    </>
                  );
                })()}
              </div>

            </div>

            {/* System generated note */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "32px" }}>
              <div style={{ textAlign: "center", minWidth: "220px" }}>
                <p style={{ fontSize: "11px", fontStyle: "italic", color: "#666", margin: 0 }}>
                  This is a system generated invoice. No signature required.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                borderTop: `2px solid ${accent}`,
                paddingTop: "12px",
                display: "flex",
                justifyContent: "center",
                gap: "24px",
                fontSize: "10px",
                color: "#888",
              }}
            >
              <span>📞 01629344993</span>
              <span style={{ color: "#ccc" }}>|</span>
              <span>📍 South Bepari Para, Agrabad, Chittagong</span>
              <span style={{ color: "#ccc" }}>|</span>
              <span>🌐 softitbd.com</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
