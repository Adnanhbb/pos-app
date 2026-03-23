export function buildA4Invoice(data: any) {

  /* ================= SAFE NUMBER NORMALIZATION ================= */
  const n = (v: any) => Number(v ?? 0);

  /* ================= SAFE ITEMS NORMALIZATION ================= */
  const items =
    Array.isArray(data.items) ? data.items :
    Array.isArray(data.cart) ? data.cart :
    [];

  const subtotal = n(data.subtotal);
  const invoiceDiscount = n(data.discount);
  const invoiceTax = n(data.tax);
  const invoiceTotal = n(data.grandTotal);
  const paid = n(data.paid);
  const balance = n(data.balance ?? data.arrears);

  /* ================= SAFE DATE ================= */
  const invoiceDate = data.date
    ? new Date(data.date).toLocaleDateString()
    : new Date().toLocaleDateString();

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

<style>

@page {
  size: A4;
  margin: 20mm;
}

body{
  font-family: Arial, Helvetica, sans-serif;
  color:#111;
  font-size:12px;
}

/* ================= HEADER ================= */

.header{
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  border-bottom:2px solid #000;
  padding-bottom:12px;
  margin-bottom:15px;
}

.businessBlock{
  display:flex;
  gap:15px;
  align-items:flex-start;
}

.logo{
  width:80px;
  height:80px;
  object-fit:contain;
}

.businessDetails{
  line-height:1.4;
}

.businessName{
  font-size:20px;
  font-weight:bold;
}

.invoiceBlock{
  text-align:right;
}

.invoiceTitle{
  font-size:24px;
  font-weight:bold;
  margin-bottom:5px;
}

/* ===== UNDERLINED LABEL ONLY ===== */

.invoiceLabel{
 text-align:center;
 font-size:16px;
 font-weight:bold;
 margin:18px 0;
}

.invoiceLabel span{
 border-bottom:2px solid #000;
 padding-bottom:2px;
}

/* ================= TABLE ================= */

table{
  width:100%;
  border-collapse:collapse;
  margin-top:15px;
}

th,td{
  border:1px solid #ccc;
  padding:7px;
  text-align:left;
}

th{
  background:#f3f3f3;
  font-weight:bold;
}

.right{
  text-align:center;
}

/* ================= TOTALS ================= */

.totalBox{
  width:320px;
  margin-left:auto;
  margin-top:20px;
}

.row{
  display:flex;
  justify-content:space-between;
  padding:4px 0;
}

.grand{
  font-size:16px;
  font-weight:bold;
  border-top:2px solid #000;
  margin-top:6px;
  padding-top:6px;
}

.balance{
  font-weight:bold;
  font-size:14px;
}

tr{
  page-break-inside:avoid;
}

/* ---------- FOOTER ---------- */

.footer{
  text-align:center;
  font-size:12px;
  margin-top:25px;
  color:#777;
}
 
.footer span{
 border-bottom:1px solid #777;
 padding-bottom:1px;
}

</style>
</head>

<body>

<!-- ================= HEADER ================= -->

<div class="header">

  <div class="businessBlock">
    ${
      data.logo
        ? `<img src="${data.logo}" class="logo" />`
        : ""
    }

    <div class="businessDetails">
      <div class="businessName">${data.businessName ?? ""}</div>
      <div>${data.address ?? ""}</div>
      <div>${data.email ?? ""}</div>
      <div>${data.contact ?? ""}</div>
    </div>
  </div>

  <div class="invoiceBlock">
    <div class="invoiceTitle">INVOICE</div>
    <div><strong>Invoice #:</strong> ${data.invoiceNo ?? ""}</div>
    <div><strong>Name:</strong> ${data.name ?? ""}</div>
    <div><strong>Date:</strong> ${invoiceDate}</div>
  </div>

</div>

<!-- ===== INVOICE TYPE LABEL ===== -->

<div class="invoiceLabel">
  <span>${invoiceLabel}</span>
</div>

<!-- ================= ITEMS TABLE ================= -->

<table>

<thead>
<tr>
<th style="width:30%">Item</th>
<th class="right">Qty</th>
<th class="right">Price</th>
<th class="right">Discount</th>
<th class="right">Tax</th>
<th class="right">Total</th>
</tr>
</thead>

<tbody>

${
items.map((i:any)=>{

 const qty = n(i.qty ?? i.quantity);
  const price = n(i.price ?? i.rate);

  const discountType = i.discountType === "flat" ? "flat" : "%";
  const discountVal = n(i.discountValue);

  const discountAmount =
    discountType === "flat"
      ? discountVal
      : (price * discountVal) / 100;

  const discountedPrice = price - discountAmount;

  const taxType = i.taxType === "flat" ? "flat" : "%";
  const taxVal = n(i.taxValue);

  const taxAmount =
    taxType === "flat"
      ? taxVal
      : (discountedPrice * taxVal) / 100;

  const lineTotal = qty * (discountedPrice + taxAmount);

  return `
  <tr>
    <td>${i.name ?? i.productName ?? ""}</td>
    <td class="right">${qty}</td>
    <td class="right">${price.toFixed(2)}</td>
    <td class="right">${discountVal} ${discountType}</td>
    <td class="right">${taxVal} ${taxType}</td>
    <td class="right">${lineTotal.toFixed(2)}</td>
  </tr>
  `;
}).join("")
}

</tbody>
</table>


<!-- ================= TOTALS ================= -->

<div class="totalBox">

  <div class="row">
    <span>Subtotal</span>
    <span>${subtotal.toFixed(2)}</span>
  </div>

  <div class="row">
    <span>Discount</span>
    <span>- ${invoiceDiscount.toFixed(2)}</span>
  </div>

  <div class="row">
    <span>Tax</span>
    <span>${invoiceTax.toFixed(2)}</span>
  </div>

${data.previousDues && data.previousDues > 0 ? `
<div class="row">
  <span>Previous Dues</span>
  <span>${n(data.previousDues).toFixed(2)}</span>
</div>
` : ""}

  <div class="row grand">
    <span>Total</span>
    <span>${invoiceTotal.toFixed(2)}</span>
  </div>

  <div class="row">
    <span>Paid</span>
    <span>${paid.toFixed(2)}</span>
  </div>

  <div class="row balance">
    <span>Balance</span>
    <span>${balance.toFixed(2)}</span>
  </div>

</div>

<!-- ================= FOOTER ================= -->

<div class="footer">
  <span>Thank you for your business | Software provided by DEVEX Technologies | 03339485125</span>
</div>

</body>
</html>
`;
}