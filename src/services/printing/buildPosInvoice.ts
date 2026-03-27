export function buildPosInvoice(data: any) {

  /* ================= INVOICE TYPE LABEL ================= */
  const inv = data.invoiceNo ?? "";

  let invoiceLabel = "INVOICE";

  if (inv.startsWith("SAL-")) invoiceLabel = "SALE INVOICE";
  else if (inv.startsWith("PUR-")) invoiceLabel = "PURCHASE INVOICE";
  else if (inv.startsWith("RET-C-")) invoiceLabel = "CUSTOMER RETURN INVOICE";
  else if (inv.startsWith("RET-S-")) invoiceLabel = "SUPPLIER RETURN INVOICE";
  else if (inv.startsWith("QTN-")) invoiceLabel = "QUOTATION";

  return `
<html>
<head>
<meta charset="UTF-8" />

<style>

body{
  font-family: monospace;
  width:80mm;
  margin:0 auto;
  color:#000;
  padding:6px;
}

/* ===== UNDERLINED LABEL ONLY ===== */

.invoiceLabel{
 text-align:center;
 font-size:10px;
 font-weight:bold;
 margin:12px 0;
}

.invoiceLabel span{
 border-bottom:1px solid #000;
 padding-bottom:1px;
}

/* ---------- TYPOGRAPHY ---------- */

.center{text-align:center}

.title{
  font-size:16px;
  font-weight:bold;
  margin-top:4px;
}

.small{
  font-size:11px;
  opacity:.9;
}

.section{
  margin-top:10px;
}

.row{
  display:flex;
  justify-content:space-between;
  font-size:12px;
  margin:2px 0;
}

.item-name{
  font-weight:bold;
  margin-top:6px;
}

.item-meta{
  font-size:11px;
  display:flex;
  justify-content:space-between;
  opacity:.85;
}

/* ---------- TOTAL BLOCK ---------- */

.totals{
  margin-top:10px;
  padding-top:6px;
}

.total-row{
  display:flex;
  justify-content:space-between;
  font-size:13px;
  margin-top:4px;
}

.grand-total{
  font-size:16px;
  font-weight:bold;
  margin-top:6px;
}

/* ---------- FOOTER ---------- */

.footer{
  text-align:center;
  font-size:11px;
  margin-top:14px;
}

.logo{
  max-height:60px;
  object-fit:contain;
  margin-bottom:4px;
}

/* ---------- ITEMS BLOCK ---------- */

.items-block{
  margin-top:10px;
  border-top:1px solid #000;
  border-bottom:1px solid #000;
  padding:4px 0;
  padding-bottom: 10px;
}
  
/* ---------- TOTAL BLOCK ---------- */

.total-block{
  border-bottom:1px solid #000;
  padding:6px 0;
}

</style>

</head>

<body>

<!-- ================= HEADER ================= -->

<div class="center">

  ${
    data.logo
      ? `<img src="${data.logo}" class="logo" />`
      : ""
  }

  <div class="title">${data.businessName}</div>
  <div class="small">${data.address}</div>
  <div class="small">${data.email}</div>
  <div class="small">${data.contact}</div>
</div>

<!-- ===== INVOICE TYPE LABEL ===== -->

<div class="invoiceLabel">
  <span>${invoiceLabel}</span>
</div>

<!-- ================= INVOICE META ================= -->

<div class="section">

  <div class="row">
    <span>Invoice #:</span>
    <span>${data.invoiceNo}</span>
  </div>

  <div class="row">
    <span>Name:</span>
    <span>${data.name}</span>
  </div>

  <div class="row">
    <span>Date:</span>
    <span>${new Date(data.date).toLocaleString()}</span>
  </div>

</div>

<!-- ================= ITEMS ================= -->

<div class="items-block">

${(data.items ?? []).map((i: any) => {

  const qty = Number(i.qty ?? 0);
  const price = Number(i.price ?? 0);

  const base = qty * price;

  // ---------- DISCOUNT ----------
  const discountType = i.discountType === "flat" ? "flat" : "%";
  const discountInput = Number(i.discountValue ?? 0);

  const discountAmount =
    discountType === "flat"
      ? discountInput
      : (base * discountInput) / 100;

  const afterDiscount = base - discountAmount;

  // ---------- TAX ----------
  const taxType = i.taxType === "flat" ? "flat" : "%";
  const taxInput = Number(i.taxValue ?? 0);

  const taxAmount =
    taxType === "flat"
      ? taxInput
      : (afterDiscount * taxInput) / 100;

  // ---------- FINAL LINE TOTAL ----------
  const lineTotal = afterDiscount + taxAmount;

  return `
    <div class="item-name">${i.name}</div>

    <div class="item-meta">
      <span>
        ${qty} x ${price}
        | Disc: ${discountInput}${discountType === "%" ? "%" : "flat"}
        | Tax: ${taxInput}${taxType === "%" ? "%" : "flat"}
      </span>

      <span>${lineTotal.toFixed(0)}</span>
    </div>
  `;
}).join("")}

</div>

<!-- ================= TOTALS ================= -->

<div class="total-block">

  <div class="total-row">
    <span>Subtotal</span>
    <span>${data.subtotal.toFixed(2)}</span>
  </div>

  <div class="total-row">
    <span>Discount</span>
    <span>${data.discount.toFixed(2)}</span>
  </div>

  <div class="total-row">
    <span>Tax</span>
    <span>${data.tax.toFixed(2)}</span>
  </div>

  <!-- Previous Dues -->
${data.previousDues && data.previousDues > 0 ? `
<div class="total-row">
  <span>Previous Dues</span>
  <span>${data.previousDues.toFixed(2)}</span>
</div>
` : ""}

  <div class="row grand-total">
    <span>TOTAL</span>
    <span>${data.grandTotal.toFixed(2)}</span>
  </div>

  <div class="total-row">
    <span>Paid</span>
    <span>${data.paid.toFixed(2)}</span>
  </div>

  <div class="total-row">
    <span>Balance</span>
    <span>${data.arrears.toFixed(2)}</span>
  </div>

</div>

<!-- ================= FOOTER ================= -->

<div class="footer">
  Thank you for your business<br>
  Software by DEVEX Technologies | 03339485125
</div>

</body>
</html>
`;
}