import { settingsRepository } from "../../repositories/settingsRepository";
import { buildPosInvoice } from "./buildPosInvoice";
import { buildA4Invoice } from "./buildA4Invoice";

export async function printInvoice(invoiceData: any) {

  // ✅ Load settings ONCE
  const settings = await settingsRepository.get();

  const printerType = settings?.printer ?? "pos";

  let html = "";

  // ✅ Common business info (single source of truth)
  const businessInfo = {
    businessName: settings.businessName ?? "",
    address: settings.address ?? "",
    email: settings.email ?? "",
    contact: settings.contact ?? "",
    logo: settings.logo ?? "",
  };

  if (printerType === "pos") {

    html = buildPosInvoice({
      ...invoiceData,
      ...businessInfo,
      date: invoiceData.date ?? new Date().toISOString(),
    });

  } else {

    // if you later store extra A4 configs
    const printSettings =
      settingsRepository.getPrintSettings
        ? await settingsRepository.getPrintSettings()
        : {};

    html = buildA4Invoice({
      ...invoiceData,
      ...businessInfo,
      ...printSettings,
      date: invoiceData.date ?? new Date().toISOString(),
    });
  }

  openPrintWindow(html);
}


/* ================= PRINT WINDOW ================= */

function openPrintWindow(html: string) {

  const win = window.open("", "_blank", "width=900,height=700");

  if (!win) return;

  win.document.open();
  win.document.write(html);
  win.document.close();

  win.focus();

  // ✅ Allow DOM + images (logo) to load before printing
  setTimeout(() => {
    win.print();
    win.close();
  }, 600);
}