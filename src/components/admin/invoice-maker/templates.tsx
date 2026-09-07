import { format } from "date-fns";

export type InvoiceItem = {
  description: string;
  qty: number;
  rate: number;
};

export type PaymentStatus = "none" | "unpaid" | "paid" | "partial";

export type InvoiceDraft = {
  invoice_number: string;
  template: string;
  currency: string;
  issue_date: string;
  due_date: string;
  logo_url: string;
  from_name: string;
  from_address: string;
  from_email: string;
  from_phone: string;
  from_extra: string;
  bank_details: string;
  to_name: string;
  to_address: string;
  to_email: string;
  to_phone: string;
  items: InvoiceItem[];
  tax_percent: number;
  discount: number;
  notes: string;
  terms: string;
  payment_status: PaymentStatus;
  amount_paid: number;
};

export const PAYMENT_STATUSES = [
  { id: "none", label: "No seal (hide)" },
  { id: "unpaid", label: "Unpaid" },
  { id: "partial", label: "Partially Paid" },
  { id: "paid", label: "Paid" },
] as const;

const SEAL_STYLES: Record<string, { color: string; label: string }> = {
  paid: { color: "#15803d", label: "PAID" },
  partial: { color: "#b45309", label: "PARTIALLY PAID" },
  unpaid: { color: "#b91c1c", label: "UNPAID" },
};


export const TEMPLATES = [
  { id: "classic", label: "Classic Ledger" },
  { id: "modern", label: "Modern Band" },
  { id: "minimal", label: "Minimal Mono" },
  { id: "corporate", label: "Corporate Accent" },
  { id: "compact", label: "Compact Statement" },
] as const;

export function currencySymbol(code: string) {
  return code === "BDT" ? "\u09F3" : "$";
}

export function money(code: string, n: number) {
  return `${currencySymbol(code)}${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function totals(d: InvoiceDraft) {
  const subtotal = d.items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0);
  const tax = (subtotal * (Number(d.tax_percent) || 0)) / 100;
  const discount = Number(d.discount) || 0;
  const total = subtotal + tax - discount;
  const status: PaymentStatus = (d.payment_status as PaymentStatus) || "unpaid";
  const paid = status === "paid" ? total : status === "partial" ? Number(d.amount_paid) || 0 : 0;
  return { subtotal, tax, discount, total, paid, balance: total - paid, status };
}

/** Rubber-stamp style payment seal shown on the invoice sheet. */
export function PaymentSeal({ status, size = 150 }: { status: PaymentStatus; size?: number }) {
  const s = SEAL_STYLES[status] ?? SEAL_STYLES.unpaid;
  const long = s.label.length > 5;
  return (
    <div
      style={{
        width: size,
        height: size,
        transform: "rotate(-14deg)",
        border: `4px double ${s.color}`,
        color: s.color,
        borderRadius: "50%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        opacity: 0.85,
        fontFamily: "Arial, Helvetica, sans-serif",
        lineHeight: 1.05,
        padding: 8,
        boxSizing: "border-box",
      }}
    >
      <div style={{ fontSize: 8, letterSpacing: 2, fontWeight: 700 }}>PAYMENT</div>
      <div style={{ fontSize: long ? size * 0.13 : size * 0.2, fontWeight: 800, letterSpacing: 1 }}>{s.label}</div>
      <div
        style={{
          marginTop: 4,
          borderTop: `1px solid ${s.color}`,
          paddingTop: 3,
          fontSize: 7,
          letterSpacing: 1,
        }}
      >
        VERIFIED
      </div>
    </div>
  );
}


function fmtDate(v: string) {
  if (!v) return "—";
  try {
    return format(new Date(v), "dd MMM yyyy");
  } catch {
    return v;
  }
}

/** All templates render on a fixed A4-ish white sheet so PDF output is predictable. */
const SHEET = "w-[794px] bg-white text-[#111] p-0 mx-auto";

function Lines({ text }: { text: string }) {
  if (!text) return null;
  return (
    <>
      {text.split("\n").map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </>
  );
}

export function InvoiceTemplate({ data }: { data: InvoiceDraft }) {
  const t = totals(data);
  const c = data.currency;
  const rows = data.items.filter((i) => i.description || i.qty || i.rate);

  if (data.template === "modern") {
    return (
      <div className={SHEET} style={{ fontFamily: "Helvetica, Arial, sans-serif" }}>
        <div className="flex items-center justify-between px-10 py-8" style={{ background: "#0f172a", color: "#fff" }}>
          <div className="flex items-center gap-4">
            {data.logo_url && <img src={data.logo_url} alt="" className="h-14 w-14 object-contain bg-white rounded p-1" />}
            <div>
              <div className="text-xl font-bold">{data.from_name || "Your Company"}</div>
              <div className="text-xs opacity-80"><Lines text={data.from_address} /></div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-light tracking-widest">INVOICE</div>
            <div className="text-sm opacity-90">#{data.invoice_number}</div>
          </div>
        </div>
        <div className="px-10 py-8">
          <div className="flex justify-between text-sm mb-8">
            <div>
              <div className="uppercase text-[10px] tracking-widest text-[#64748b] mb-1">Billed to</div>
              <div className="font-semibold">{data.to_name || "—"}</div>
              <Lines text={data.to_address} />
              <div>{data.to_email}</div>
              <div>{data.to_phone}</div>
            </div>
            <div className="text-right">
              <div>Issue date: <b>{fmtDate(data.issue_date)}</b></div>
              <div>Due date: <b>{fmtDate(data.due_date)}</b></div>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#f1f5f9" }}>
                <th className="text-left p-2">Description</th>
                <th className="text-right p-2 w-20">Qty</th>
                <th className="text-right p-2 w-28">Rate</th>
                <th className="text-right p-2 w-32">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid #e2e8f0" }}>
                  <td className="p-2">{i.description}</td>
                  <td className="p-2 text-right">{i.qty}</td>
                  <td className="p-2 text-right">{money(c, Number(i.rate) || 0)}</td>
                  <td className="p-2 text-right">{money(c, (Number(i.qty) || 0) * (Number(i.rate) || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Summary c={c} t={t} data={data} align="right" />
          <Footer data={data} />
        </div>
      </div>
    );
  }

  if (data.template === "minimal") {
    return (
      <div className={SHEET} style={{ fontFamily: "'Courier New', monospace" }}>
        <div className="px-12 py-12">
          <div className="flex items-start justify-between border-b-2 border-black pb-4 mb-8">
            <div>
              {data.logo_url && <img src={data.logo_url} alt="" className="h-10 object-contain mb-2" />}
              <div className="text-lg font-bold uppercase">{data.from_name || "Your Company"}</div>
              <div className="text-xs"><Lines text={data.from_address} /></div>
              <div className="text-xs">{data.from_email} {data.from_phone}</div>
            </div>
            <div className="text-right text-xs">
              <div className="text-2xl font-bold">INVOICE</div>
              <div>NO. {data.invoice_number}</div>
              <div>DATE {fmtDate(data.issue_date)}</div>
              <div>DUE {fmtDate(data.due_date)}</div>
            </div>
          </div>
          <div className="text-xs mb-6">
            <div className="uppercase">To:</div>
            <div className="font-bold">{data.to_name || "—"}</div>
            <Lines text={data.to_address} />
            <div>{data.to_email}</div>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-y border-black">
                <th className="text-left py-2">ITEM</th>
                <th className="text-right py-2 w-16">QTY</th>
                <th className="text-right py-2 w-24">RATE</th>
                <th className="text-right py-2 w-28">TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i, idx) => (
                <tr key={idx}>
                  <td className="py-1.5">{i.description}</td>
                  <td className="py-1.5 text-right">{i.qty}</td>
                  <td className="py-1.5 text-right">{money(c, Number(i.rate) || 0)}</td>
                  <td className="py-1.5 text-right">{money(c, (Number(i.qty) || 0) * (Number(i.rate) || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Summary c={c} t={t} data={data} align="right" mono />
          <Footer data={data} />
        </div>
      </div>
    );
  }

  if (data.template === "corporate") {
    return (
      <div className={SHEET} style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
        <div className="flex">
          <div style={{ width: 14, background: "#b91c1c" }} />
          <div className="flex-1 px-10 py-10">
            <div className="flex items-start justify-between mb-8">
              <div>
                <div className="text-3xl" style={{ color: "#b91c1c" }}>Invoice</div>
                <div className="text-sm text-[#555]">#{data.invoice_number}</div>
              </div>
              <div className="text-right">
                {data.logo_url && <img src={data.logo_url} alt="" className="h-16 object-contain ml-auto mb-2" />}
                <div className="font-bold">{data.from_name || "Your Company"}</div>
                <div className="text-xs text-[#555]"><Lines text={data.from_address} /></div>
                <div className="text-xs text-[#555]">{data.from_email}</div>
                <div className="text-xs text-[#555]">{data.from_phone}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-6 text-sm mb-8">
              <div className="p-4" style={{ background: "#faf5f5" }}>
                <div className="text-[10px] uppercase tracking-widest text-[#b91c1c] mb-1">Bill to</div>
                <div className="font-bold">{data.to_name || "—"}</div>
                <Lines text={data.to_address} />
                <div>{data.to_email}</div>
                <div>{data.to_phone}</div>
              </div>
              <div className="p-4" style={{ background: "#faf5f5" }}>
                <div className="text-[10px] uppercase tracking-widest text-[#b91c1c] mb-1">Details</div>
                <div>Issued: {fmtDate(data.issue_date)}</div>
                <div>Due: {fmtDate(data.due_date)}</div>
                <div>Currency: {c}</div>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "2px solid #b91c1c" }}>
                  <th className="text-left py-2">Description</th>
                  <th className="text-right py-2 w-20">Qty</th>
                  <th className="text-right py-2 w-28">Rate</th>
                  <th className="text-right py-2 w-32">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i, idx) => (
                  <tr key={idx} style={{ borderBottom: "1px solid #eee" }}>
                    <td className="py-2">{i.description}</td>
                    <td className="py-2 text-right">{i.qty}</td>
                    <td className="py-2 text-right">{money(c, Number(i.rate) || 0)}</td>
                    <td className="py-2 text-right">{money(c, (Number(i.qty) || 0) * (Number(i.rate) || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Summary c={c} t={t} data={data} align="right" />
            <Footer data={data} />
          </div>
        </div>
      </div>
    );
  }

  if (data.template === "compact") {
    return (
      <div className={SHEET} style={{ fontFamily: "Verdana, Geneva, sans-serif" }}>
        <div className="px-8 py-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              {data.logo_url && <img src={data.logo_url} alt="" className="h-10 object-contain" />}
              <div className="text-base font-bold">{data.from_name || "Your Company"}</div>
            </div>
            <div className="text-xs text-right">
              <div className="font-bold text-sm">STATEMENT / INVOICE</div>
              <div>#{data.invoice_number} · {fmtDate(data.issue_date)}</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-[11px] mb-5">
            <div className="border p-2">
              <div className="font-bold mb-1">From</div>
              <Lines text={data.from_address} />
              <div>{data.from_email}</div>
              <div>{data.from_phone}</div>
            </div>
            <div className="border p-2">
              <div className="font-bold mb-1">To</div>
              <div>{data.to_name}</div>
              <Lines text={data.to_address} />
              <div>{data.to_email}</div>
            </div>
            <div className="border p-2">
              <div className="font-bold mb-1">Payment</div>
              <div>Due: {fmtDate(data.due_date)}</div>
              <Lines text={data.bank_details} />
            </div>
          </div>
          <table className="w-full text-[11px] border">
            <thead>
              <tr style={{ background: "#eee" }}>
                <th className="text-left p-1.5 border">#</th>
                <th className="text-left p-1.5 border">Description</th>
                <th className="text-right p-1.5 border w-14">Qty</th>
                <th className="text-right p-1.5 border w-24">Rate</th>
                <th className="text-right p-1.5 border w-28">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i, idx) => (
                <tr key={idx}>
                  <td className="p-1.5 border">{idx + 1}</td>
                  <td className="p-1.5 border">{i.description}</td>
                  <td className="p-1.5 border text-right">{i.qty}</td>
                  <td className="p-1.5 border text-right">{money(c, Number(i.rate) || 0)}</td>
                  <td className="p-1.5 border text-right">{money(c, (Number(i.qty) || 0) * (Number(i.rate) || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Summary c={c} t={t} data={data} align="right" />
          <Footer data={data} compact />
        </div>
      </div>
    );
  }

  // classic (default)
  return (
    <div className={SHEET} style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
      <div className="px-10 py-10">
        <div className="flex items-start justify-between mb-8 pb-6" style={{ borderBottom: "3px double #111" }}>
          <div className="flex items-start gap-4">
            {data.logo_url && <img src={data.logo_url} alt="" className="h-16 w-16 object-contain" />}
            <div>
              <div className="text-xl font-bold">{data.from_name || "Your Company"}</div>
              <div className="text-xs text-[#555]"><Lines text={data.from_address} /></div>
              <div className="text-xs text-[#555]">{data.from_email}</div>
              <div className="text-xs text-[#555]">{data.from_phone}</div>
              <div className="text-xs text-[#555]"><Lines text={data.from_extra} /></div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tracking-wide">INVOICE</div>
            <div className="text-sm">No. {data.invoice_number}</div>
            <div className="text-sm">Date: {fmtDate(data.issue_date)}</div>
            <div className="text-sm">Due: {fmtDate(data.due_date)}</div>
          </div>
        </div>
        <div className="text-sm mb-6">
          <div className="uppercase text-[10px] tracking-widest text-[#777] mb-1">Bill to</div>
          <div className="font-semibold">{data.to_name || "—"}</div>
          <Lines text={data.to_address} />
          <div>{data.to_email}</div>
          <div>{data.to_phone}</div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "#111", color: "#fff" }}>
              <th className="text-left p-2">Description</th>
              <th className="text-right p-2 w-20">Qty</th>
              <th className="text-right p-2 w-28">Rate</th>
              <th className="text-right p-2 w-32">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i, idx) => (
              <tr key={idx} style={{ borderBottom: "1px solid #ddd" }}>
                <td className="p-2">{i.description}</td>
                <td className="p-2 text-right">{i.qty}</td>
                <td className="p-2 text-right">{money(c, Number(i.rate) || 0)}</td>
                <td className="p-2 text-right">{money(c, (Number(i.qty) || 0) * (Number(i.rate) || 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Summary c={c} t={t} data={data} align="right" />
        <Footer data={data} />
      </div>
    </div>
  );
}

function Summary({
  c,
  t,
  data,
  align,
  mono,
}: {
  c: string;
  t: ReturnType<typeof totals>;
  data: InvoiceDraft;
  align: "right" | "left";
  mono?: boolean;
}) {
  return (
    <div className={`mt-5 flex items-center ${align === "right" ? "justify-between" : "justify-start"}`}>
      <PaymentSeal status={t.status} />
      <div className={`w-72 text-sm ${mono ? "text-xs" : ""}`}>
        <Row label="Subtotal" value={money(c, t.subtotal)} />
        {Number(data.tax_percent) > 0 && <Row label={`Tax (${data.tax_percent}%)`} value={money(c, t.tax)} />}
        {Number(data.discount) > 0 && <Row label="Discount" value={`- ${money(c, t.discount)}`} />}
        <div className="flex justify-between py-2 mt-1 font-bold text-base" style={{ borderTop: "2px solid #111" }}>
          <span>Total</span>
          <span>{money(c, t.total)}</span>
        </div>
        {t.status !== "unpaid" && <Row label="Amount paid" value={money(c, t.paid)} />}
        {t.status !== "paid" && (
          <div className="flex justify-between py-1 font-semibold">
            <span>Balance due</span>
            <span>{money(c, t.balance)}</span>
          </div>
        )}
      </div>
    </div>
  );

}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1" style={{ borderBottom: "1px solid #eee" }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Footer({ data, compact }: { data: InvoiceDraft; compact?: boolean }) {
  const hasBank = !!data.bank_details && !compact;
  const hasBlocks = hasBank || !!data.notes || !!data.terms;
  return (
    <>
      {hasBlocks && (
        <div className={`mt-8 grid ${hasBank ? "grid-cols-2" : "grid-cols-1"} gap-6 text-xs text-[#444]`}>
          {hasBank && (
            <div>
              <div className="font-bold uppercase tracking-widest text-[10px] mb-1">Bank details</div>
              <Lines text={data.bank_details} />
            </div>
          )}
          <div>
            {data.notes && (
              <div className="mb-3">
                <div className="font-bold uppercase tracking-widest text-[10px] mb-1">Notes</div>
                <Lines text={data.notes} />
              </div>
            )}
            {data.terms && (
              <div>
                <div className="font-bold uppercase tracking-widest text-[10px] mb-1">Payment terms</div>
                <Lines text={data.terms} />
              </div>
            )}
          </div>
        </div>
      )}
      <div
        className="mt-8 pt-3 text-center text-[10px] text-[#666]"
        style={{ borderTop: "1px solid #ddd" }}
      >
        This is a system generated invoice — no signature is required.
      </div>
    </>
  );
}

