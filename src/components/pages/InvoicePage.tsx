import { useParams } from "@/lib/router-compat";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Printer, Pencil, Check, Download } from "lucide-react";
import { useState, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export default function InvoicePage() {
  const { requestId } = useParams<{ requestId: string }>();
  const { isAdmin } = useAuth();
  const [editMode, setEditMode] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const invoiceRef = useRef<HTMLDivElement>(null);

  async function handleDownloadPdf() {
    if (!invoiceRef.current) return;
    setDownloading(true);
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const el = invoiceRef.current;
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        windowWidth: el.scrollWidth,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgH = (canvas.height * pageW) / canvas.width;
      let heightLeft = imgH;
      let position = 0;
      pdf.addImage(imgData, "PNG", 0, position, pageW, imgH);
      heightLeft -= pageH;
      while (heightLeft > 0) {
        position = heightLeft - imgH;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, pageW, imgH);
        heightLeft -= pageH;
      }
      pdf.save(`Invoice-${data?.invoice?.invoice_number || requestId}.pdf`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to generate PDF");
    } finally {
      setDownloading(false);
    }
  }

  const { data, isLoading } = useQuery({
    queryKey: ["invoice", requestId],
    queryFn: async () => {
      // Try client top-up invoice first
      const { data: invoice } = await (supabase as any)
        .from("invoices")
        .select("*")
        .eq("top_up_request_id", requestId)
        .maybeSingle();

      if (invoice) {
        const { data: request } = await supabase
          .from("top_up_requests")
          .select("*")
          .eq("id", requestId!)
          .maybeSingle();
        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("user_id", invoice.user_id)
          .maybeSingle();

        // How much of this deposit was pulled into the secondary wallet
        // (auto-settlement moves main surplus onto secondary due).
        const from = new Date(new Date(invoice.created_at).getTime() - 5 * 60 * 1000).toISOString();
        const to = new Date(new Date(invoice.created_at).getTime() + 30 * 60 * 1000).toISOString();
        const { data: settleTx } = await (supabase as any)
          .from("transactions")
          .select("amount, wallet_kind, description, created_at")
          .eq("user_id", invoice.user_id)
          .eq("wallet_kind", "secondary")
          .gte("created_at", from)
          .lte("created_at", to);
        const secondaryUsd = (settleTx ?? [])
          .filter((t: any) => String(t.description || "").toLowerCase().includes("secondary wallet due settled"))
          .reduce((s: number, t: any) => s + Number(t.amount || 0), 0);

        return { invoice, request, profile, secondaryUsd };
      }


      // Fallback: tenant_payments — synthesize invoice
      const { data: tp } = await (supabase as any)
        .from("tenant_payments")
        .select("*, tenants(name, domain, usd_rate)")
        .eq("id", requestId!)
        .maybeSingle();
      if (!tp) return { invoice: null, request: null, profile: null };

      const rate = Number(tp.tenants?.usd_rate) || 120;
      const bdt = Number(tp.amount) || 0;
      const usd = tp.limit_amount != null && Number(tp.limit_amount) !== 0
        ? Number(tp.limit_amount)
        : (rate > 0 ? bdt / rate : 0);

      const synthInvoice = {
        invoice_number: `TP-${String(tp.id).slice(0, 8).toUpperCase()}`,
        created_at: tp.created_at,
        amount: usd,
        bdt_amount: bdt,
        usd_rate: rate,
        user_id: tp.tenant_id,
        _tenant: true,
        _payment_type: tp.payment_type,
      };
      const synthRequest = {
        payment_reference: tp.payment_reference || null,
        sheet_bill_bdt: 0,
        wallet_due_paid_bdt: 0,
      };
      const synthProfile = {
        company: tp.tenants?.name || "Tenant",
        full_name: tp.tenants?.name || "Tenant",
        business_address: tp.tenants?.domain || null,
        phone: null,
        email: tp.tenants?.domain || null,
      };
      return { invoice: synthInvoice, request: synthRequest, profile: synthProfile };
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
  const secondaryUsd = Number((data as any)?.secondaryUsd ?? 0);
  const secondaryRate = Number((profile as any)?.secondary_usd_rate ?? 0);

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
            Print
          </Button>
          <Button onClick={handleDownloadPdf} disabled={downloading} className="gap-2 ml-2">
            <Download className="h-4 w-4" />
            {downloading ? "Generating..." : "Download PDF"}
          </Button>
        </div>

        {/* A4 container: 210mm x 297mm */}
        <div
          ref={invoiceRef}
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

                  const rows: Array<{ desc: string; rate: string; qty: string; total: number }> = [];

                  // Dual-wallet split stored at approval time (main due →
                  // secondary due at its own rate → main wallet deposit).
                  const splitMainDue = Number((request as any)?.main_due_bdt ?? 0);
                  const splitSecDue = Number((request as any)?.secondary_due_bdt ?? 0);
                  const splitMainDep = Number((request as any)?.main_deposit_bdt ?? 0);
                  const hasSplit = splitMainDue + splitSecDue + splitMainDep > 0.5;

                  if (hasSplit) {
                    const rateStr = rate > 0 ? `৳${rate.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—";
                    const secRateStr = secondaryRate > 0 ? `৳${secondaryRate.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—";
                    if (splitMainDue > 0.5) {
                      rows.push({
                        desc: "Main Wallet Due Adjustment",
                        rate: rateStr,
                        qty: (rate > 0 ? splitMainDue / rate : 0).toLocaleString(undefined, { minimumFractionDigits: 2 }),
                        total: splitMainDue,
                      });
                    }
                    if (splitSecDue > 0.5) {
                      rows.push({
                        desc: "Secondary Wallet Due Adjustment",
                        rate: secRateStr,
                        qty: (secondaryRate > 0 ? splitSecDue / secondaryRate : 0).toLocaleString(undefined, { minimumFractionDigits: 2 }),
                        total: splitSecDue,
                      });
                    }
                    if (splitMainDep > 0.5) {
                      rows.push({
                        desc: "Main Wallet Deposit",
                        rate: rateStr,
                        qty: (rate > 0 ? splitMainDep / rate : 0).toLocaleString(undefined, { minimumFractionDigits: 2 }),
                        total: splitMainDep,
                      });
                    }
                  } else {

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
                  const metaUsd =
                    remainderBdt > 0.5 && remainderUsd > 0
                      ? remainderUsd
                      : !hasStored && usdQty > 0
                        ? usdQty
                        : 0;
                  const metaBdt =
                    remainderBdt > 0.5 && remainderUsd > 0 ? remainderBdt : metaUsd * rate;
                  if (metaUsd > 0) {
                    const secUsd = Math.min(Math.max(0, secondaryUsd), metaUsd);
                    const mainUsd = metaUsd - secUsd;
                    const rateStr = `৳${rate.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
                    if (secUsd > 0.005) {
                      if (mainUsd > 0.005) {
                        rows.push({
                          desc: "Meta Advertising — Main Wallet",
                          rate: rateStr,
                          qty: mainUsd.toLocaleString(undefined, { minimumFractionDigits: 2 }),
                          total: mainUsd * rate,
                        });
                      }
                      rows.push({
                        desc: "Meta Advertising — Secondary Wallet Adjustment",
                        rate: rateStr,
                        qty: secUsd.toLocaleString(undefined, { minimumFractionDigits: 2 }),
                        total: metaBdt - mainUsd * rate,
                      });
                    } else {
                      rows.push({
                        desc: "Meta Advertising",
                        rate: rateStr,
                        qty: metaUsd.toLocaleString(undefined, { minimumFractionDigits: 2 }),
                        total: metaBdt,
                      });
                    }
                  }
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
                  {secondaryUsd > 0.005 && (
                    <p style={{ fontSize: "10px", color: "#888", lineHeight: 1.6 }}>
                      Wallet split: Main ${(Math.max(0, (Number(invoice.amount) || 0) - secondaryUsd)).toLocaleString(undefined, { minimumFractionDigits: 2 })} · Secondary ${secondaryUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  )}
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
