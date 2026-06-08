import * as pdfjsLib from "./vendor/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";

const defaultPdfName = "تفاصيل المبيعات (3).pdf";
const els = {
  input: document.querySelector("#pdfInput"),
  fileName: document.querySelector("#fileName"),
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  ocrRetryButton: document.querySelector("#ocrRetryButton"),
  pageCount: document.querySelector("#pageCount"),
  totalSales: document.querySelector("#totalSales"),
  totalQty: document.querySelector("#totalQty"),
  productCount: document.querySelector("#productCount"),
  avgUnit: document.querySelector("#avgUnit"),
  topQty: document.querySelector("#topQty"),
  reportMeta: document.querySelector("#reportMeta"),
  insights: document.querySelector("#insights"),
  focusCards: document.querySelector("#focusCards"),
  priceBands: document.querySelector("#priceBands"),
  dailyExtract: document.querySelector("#dailyExtract"),
  copyExtract: document.querySelector("#copyExtract"),
  calculationReview: document.querySelector("#calculationReview"),
  offerRowsBody: document.querySelector("#offerRowsBody"),
  discountRowsBody: document.querySelector("#discountRowsBody"),
  ordersInput: document.querySelector("#ordersInput"),
  orderSalesInput: document.querySelector("#orderSalesInput"),
  barChart: document.querySelector("#barChart"),
  productsBody: document.querySelector("#productsBody"),
  search: document.querySelector("#searchInput"),
  preview: document.querySelector("#pdfPreview"),
  previewLabel: document.querySelector("#previewLabel"),
};

const moneyFormatter = new Intl.NumberFormat("ar-SA", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const numberFormatter = new Intl.NumberFormat("ar-SA", {
  maximumFractionDigits: 1,
});
const extractNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const OFFER_DISCOUNT_MAP = [
  {
    offerName: "Bundle(M+D)",
    discountCode: "on your order 100%",
    unitDiscount: 21.74,
    bundleKey: "magicD5",
  },
  {
    offerName: "Bundle (P+M)",
    discountCode: "on your order 100%",
    unitDiscount: 46.09,
    bundleKey: "pinkMusk",
  },
  {
    offerName: "Bundle ( D + W)",
    discountCode: "on your order 100%",
    unitDiscount: 67.83,
    bundleKey: "discoveryWinter",
  },
  {
    offerName: "MMT Bundle",
    discountCode: "on your order 100%",
    unitDiscount: 100,
    bundleKey: "mmt",
  },
  {
    offerName: "MMT Bundle",
    discountCode: "100.01 per point on your order",
    unitDiscount: 100.01,
    bundleKey: "mmt",
  },
  {
    offerName: "MMT Bundle",
    discountCode: "100.01 per order on your order",
    unitDiscount: 100.01,
    bundleKey: "mmt",
  },
];

let allProducts = [];
let allExtractProducts = [];
let currentExtractText = "";
let currentExtractPayload = null;
let mappedDailyQuantities = {};
let sessionOrderTotal = null;
let sessionOrderSales = null;
let latestPdfText = "";
let aiPdfTotalQty = null;
let aiOfferDiscountQty = null;
let discountBundleCounts = {
  pinkMusk: null,
  discoveryWinter: null,
  magicD5: null,
  mmt: null,
};
let offerReviewRows = [];
let discountReviewRows = [];
let offersSummary = [];
let offerDiscountQuantityTotal = 0;
let pdfGrandQuantityTotal = null;
let lastPdfSalesTotal = 0;
let lastPdfQtyTotal = 0;
let hasReport = false;
let lastPdfBytes = null;
let lastPdfName = "";

function setStatus(text, type = "ready") {
  els.statusText.textContent = text;
  els.statusDot.className = `status-dot ${type === "ready" ? "" : type}`;
}

function setOcrRetryVisible(visible) {
  els.ocrRetryButton.hidden = !visible;
}

function ensureOfferSummaryTables() {
  const offerTable = els.offerRowsBody?.closest("table");
  const offerHeadRow = offerTable?.querySelector("thead tr");
  if (offerHeadRow) {
    offerHeadRow.innerHTML = `
      <th>Ø§Ù„Ø¹Ø±Ø¶</th>
      <th>Ø§Ù„ÙƒÙ…ÙŠØ©</th>
      <th>Ø§Ù„Ù‚ÙŠÙ…Ø©</th>
    `;
  }

  if (els.discountRowsBody || !offerTable) return;
  const block = document.createElement("div");
  block.className = "review-block";
  block.innerHTML = `
    <p class="section-kicker">Discount Summary</p>
    <div class="offer-table-wrap">
      <table class="offer-table">
        <thead>
          <tr>
            <th>Discount Code</th>
            <th>Invoice / Order</th>
            <th>Total Discount</th>
          </tr>
        </thead>
        <tbody id="discountRowsBody">
          <tr><td colspan="3">Discount Summary will appear here.</td></tr>
        </tbody>
      </table>
    </div>
  `;
  offerTable.closest(".review-block")?.after(block);
  els.discountRowsBody = document.querySelector("#discountRowsBody");
}

function resetEmptyState() {
  ensureOfferSummaryTables();
  hasReport = false;
  offerReviewRows = [];
  discountReviewRows = [];
  offersSummary = [];
  offerDiscountQuantityTotal = 0;
  pdfGrandQuantityTotal = null;
  document.body.classList.remove("has-report");
  els.fileName.textContent = "لم يتم تحميل ملف";
  els.reportMeta.textContent = "بانتظار التقرير";
  els.pageCount.textContent = "-";
  els.totalSales.textContent = "-";
  els.totalQty.textContent = "-";
  els.productCount.textContent = "-";
  els.avgUnit.textContent = "-";
  els.topQty.textContent = "-";
  els.insights.innerHTML = "";
  els.focusCards.innerHTML = "";
  els.priceBands.innerHTML = "";
  els.barChart.innerHTML = "";
  els.preview.replaceChildren();
  els.productsBody.innerHTML = "<tr><td colspan='6'>ارفع ملف PDF لعرض المنتجات.</td></tr>";
  els.dailyExtract.textContent = "سيظهر المستخرج هنا بعد تحميل ملف PDF.";
  els.calculationReview.textContent = "ستظهر تفاصيل حساب UPT بعد تحميل PDF.";
  els.offerRowsBody.innerHTML = "<tr><td colspan='3'>ستظهر عروض on your order هنا.</td></tr>";
  setStatus("ارفع ملف PDF لبدء التحليل وعرض القيم.", "ready");
  setOcrRetryVisible(false);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cleanText(value) {
  return value
    .replace(/[﷼]/g, "")
    .replace(/\b(?:Total|Tax|excluded|المنتج|الكمية|الوحدات|فئة)\b/gi, "")
    .replace(/[()[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDigits(value) {
  return String(value)
    .replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit))
    .replace(/[۰-۹]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹".indexOf(digit))
    .replace(/[−–—]/g, "-")
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
}

function parseAmount(value) {
  const match = normalizeDigits(value).replace(/[﷼]/g, "").match(/-?\s*[\d,]+\.\d{2}/);
  return match ? Number(match[0].replace(/\s|,/g, "")) : null;
}

function parseQty(value) {
  const match = normalizeDigits(value).match(/(?:^|\s)(\d+(?:\.\d)?)(?:\s|$)/);
  return match ? Number(match[1]) : null;
}

function extractBarcode(value) {
  const match = normalizeDigits(value).match(/\[\s*(\d{8,})\s*\]|\]\s*(\d{8,})\s*\[|(\d{8,})/);
  return match ? match[1] || match[2] || match[3] : "";
}

function groupItemsByLine(items) {
  const lines = [];
  const sorted = items
    .filter((item) => item.str && item.str.trim())
    .map((item) => ({
      text: item.str.trim(),
      x: item.transform[4],
      y: Math.round(item.transform[5]),
    }))
    .sort((a, b) => b.y - a.y || b.x - a.x);

  for (const item of sorted) {
    const line = lines.find((entry) => Math.abs(entry.y - item.y) <= 3);
    if (line) {
      line.items.push(item);
      line.y = Math.round((line.y + item.y) / 2);
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }

  return lines
    .map((line) => {
      const itemsByX = line.items.sort((a, b) => b.x - a.x);
      return {
        y: line.y,
        text: itemsByX.map((item) => item.text).join(" "),
        items: itemsByX,
      };
    })
    .filter((line) => !/تقرير\s+المبيعات|معرف\s+الجلسة|شركة|الراجحي|^\d+\s*\/\s*\d+/.test(line.text));
}

function rowFromLine(line) {
  const text = line.text;
  const amount = parseAmount(text);
  const barcode = extractBarcode(text);
  const qtyItems = line.items
    .map((item) => ({ value: parseQty(item.text), x: item.x, text: item.text }))
    .filter((item) => item.value !== null && item.value < 10000 && (!amount || Math.abs(item.value - amount) > 0.01));
  const qty = (barcode ? qtyItems.at(-1)?.value : qtyItems[0]?.value) ?? null;

  if (amount === null || qty === null) {
    return null;
  }

  let product = cleanText(text)
    .replace(/[\d,]+\.\d{2}/g, "")
    .replace(/\b\d+(?:\.\d)?\b/g, "")
    .replace(/\bPerfume\b/gi, "")
    .trim();

  if (!product || product.length < 3) {
    return null;
  }

  product = product.replace(/\s+/g, " ");
  return { product, barcode, qty, amount, unitPrice: amount / qty, rawText: text };
}

function rowFromText(text) {
  const normalizedText = normalizeDigits(text).replace(/\s+/g, " ").trim();
  const amount = parseAmount(normalizedText);
  const barcode = extractBarcode(normalizedText);
  const qtyCandidates = [...normalizedText.matchAll(/(?:^|\s)(\d+(?:\.\d)?)(?:\s|$)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value !== null && value < 10000 && (!amount || Math.abs(value - amount) > 0.01));
  const filteredQty = /100\s*%/.test(normalizedText) ? qtyCandidates.filter((value) => Math.abs(value - 100) > 0.01) : qtyCandidates;
  const qty = filteredQty[0] ?? qtyCandidates[0] ?? null;

  if (amount === null || qty === null) {
    return null;
  }

  let product = cleanText(normalizedText)
    .replace(/-?\s*[\d,]+\.\d{2}/g, "")
    .replace(/\b\d{8,}\b/g, "")
    .replace(/\b\d+(?:\.\d)?\b/g, "")
    .replace(/\b(?:units?|each|Perfume)\b/gi, "")
    .trim();

  if (!product || product.length < 3) {
    return null;
  }

  product = product.replace(/\s+/g, " ");
  return { product, barcode, qty, amount, unitPrice: amount / qty, rawText: normalizedText };
}

function rowsFromOcrText(text, pageIndex = null) {
  const lines = normalizeDigits(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows = [];
  const seen = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const candidates = [
      lines[index],
      `${lines[index]} ${lines[index + 1] || ""}`.trim(),
      `${lines[index]} ${lines[index + 1] || ""} ${lines[index + 2] || ""}`.trim(),
    ];
    const row = candidates.map((candidate) => rowFromText(candidate)).find(Boolean);
    if (row && !seen.has(row.rawText)) {
      row.pageIndex = pageIndex;
      seen.add(row.rawText);
      rows.push(row);
    }
  }

  return rows;
}

function mergeContinuationRows(rows) {
  return rows
    .filter((row) => row.barcode)
    .filter((row) => !/^Perfume$/i.test(row.product))
    .map((row) => ({
      ...row,
      product: row.product.replace(/\s+Each$/i, "").trim(),
      unitPrice: row.amount / row.qty,
    }));
}

function isGrandTotalRow(row) {
  const text = `${row.rawText || ""} ${row.product || ""}`;
  return /الإجمالي|اجمالي|ﻲﻟﺎﻤﺟﻹﺍ|ﻲﻟﺎﻤﺟﻻﺍ/i.test(text);
}

function extractPdfGrandQuantityTotal(rows) {
  const totalRow = rows
    .filter((row) => isGrandTotalRow(row) && row.amount > 0 && row.qty > 0)
    .at(-1);
  if (totalRow) return totalRow.qty;

  const fallbackRows = rows
    .filter((row) => !row.barcode && row.amount > 0 && row.qty > 0 && !isOfferDiscount(row))
    .sort((a, b) => b.qty - a.qty);
  return fallbackRows[0]?.qty ?? null;
}

async function renderPageToCanvas(page, scale = 2) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

function getOcrScale(pdf) {
  const isSmallDevice = window.matchMedia?.("(max-width: 760px)")?.matches || navigator.deviceMemory <= 4;
  if (pdf.numPages > 8 || isSmallDevice) return 1.35;
  if (pdf.numPages > 4) return 1.6;
  return 2;
}

async function extractRowsWithOcr(pdf) {
  const { createWorker } = await import("./vendor/tesseract.esm.min.js");
  const worker = await createWorker("eng+ara", 1, {
    workerPath: new URL("./vendor/tesseract-worker.min.js", import.meta.url).href,
    langPath: "https://tessdata.projectnaptha.com/4.0.0",
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@v7.0.0",
    gzip: true,
    logger: (message) => {
      if (message.status === "recognizing text") {
        setStatus(`PDF مصور: جاري قراءة النص بالـ OCR... ${Math.round((message.progress || 0) * 100)}%`, "loading");
      }
    },
  });

  const rows = [];
  const pageTexts = [];
  const ocrScale = getOcrScale(pdf);
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      setStatus(`PDF مصور: تجهيز الصفحة ${pageNumber} من ${pdf.numPages} للقراءة...`, "loading");
      const page = await pdf.getPage(pageNumber);
      const canvas = await renderPageToCanvas(page, ocrScale);
      const result = await worker.recognize(canvas);
      pageTexts.push(result.data.text);
      rows.push(...rowsFromOcrText(result.data.text, pageNumber - 1));
    }
  } finally {
    await worker.terminate();
  }

  return { rows, pageTexts, rawPageTexts: pageTexts };
}

function applyAnalysisRows({ rows, pageTexts, rawPageTexts, pdf, name, usedOcr }) {
  if (!rows.length) {
    throw new Error("No analyzable rows found");
  }

  latestPdfText = pageTexts.join("\n");
  const offerSummaries = buildOfferAndDiscountSummaries(rows, pageTexts, rawPageTexts);
  offerReviewRows = offerSummaries.offers;
  discountReviewRows = offerSummaries.unmatchedDiscounts;
  offersSummary = buildPdfOfferRowsSummary(rows, pageTexts, rawPageTexts);
  if (!offersSummary.length) {
    offersSummary = extractPdfOfferRowsSummaryFromText(pageTexts, rawPageTexts);
  }
  offerDiscountQuantityTotal = offersSummary.reduce((sum, offer) => sum + offer.qty, 0);
  pdfGrandQuantityTotal = extractPdfGrandQuantityTotal(rows);
  allExtractProducts = mergeContinuationRows(rows);
  allProducts = allExtractProducts.filter((row) => row.amount > 0);
  aiPdfTotalQty = null;
  aiOfferDiscountQty = null;
  discountBundleCounts = offerReviewRows.reduce(
    (counts, row) => {
      if (row.bundleKey) counts[row.bundleKey] = (counts[row.bundleKey] || 0) + row.repeatCount;
      return counts;
    },
    { pinkMusk: 0, discoveryWinter: 0, magicD5: 0, mmt: 0 },
  );
  mappedDailyQuantities = extractMappedDailyQuantities(latestPdfText);
  renderDashboard(pdf.numPages, allProducts, latestPdfText, name);
  hasReport = true;
  document.body.classList.add("has-report");
  setOcrRetryVisible(false);
  setStatus(
    usedOcr
      ? "تم تحليل PDF المصور باستخدام OCR. راجع جدول العروض والمستخرج للتأكد من الأرقام."
      : "تم تحليل التقرير بنجاح. الواجهة تعرض الآن مؤشرات تفصيلية قابلة للبحث والمراجعة.",
    "ready",
  );
}

async function analyzePdf(source, name, options = {}) {
  const forceOcr = options.forceOcr || false;
  hasReport = false;
  setOcrRetryVisible(false);
  if (!forceOcr) document.body.classList.remove("has-report");
  setStatus("جاري قراءة الصفحات واستخراج جدول المبيعات والمؤشرات التفصيلية...", "loading");
  els.fileName.textContent = name;
  els.previewLabel.textContent = "الصفحة الأولى";

  const loadingTask = pdfjsLib.getDocument(source);
  const pdf = await loadingTask.promise;
  await renderPreview(pdf);
  if (!forceOcr) {
    const rows = [];
    const pageTexts = [];
    const rawPageTexts = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      rawPageTexts.push(content.items.map((item) => item.str).join("\n"));
      const lines = groupItemsByLine(content.items);
      pageTexts.push(lines.map((line) => line.text).join(" "));
      for (const line of lines) {
        const row = rowFromLine(line);
        if (row) rows.push({ ...row, pageIndex: pageNumber - 1 });
      }
    }

    if (mergeContinuationRows(rows).length) {
      applyAnalysisRows({ rows, pageTexts, rawPageTexts, pdf, name, usedOcr: false });
      return;
    }
  }

  setStatus("لم أجد نصًا كافيًا داخل PDF. سأحاول قراءة الملف كصورة باستخدام OCR...", "loading");
  const ocrResult = await extractRowsWithOcr(pdf);
  applyAnalysisRows({ ...ocrResult, pdf, name, usedOcr: true });
}

async function renderPreview(pdf) {
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1.6 });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: context, viewport }).promise;
  els.preview.replaceChildren(canvas);
}

function renderDashboard(pageCount, products, allText, name) {
  const totalSales = products.reduce((sum, row) => sum + row.amount, 0);
  const totalQty = products.reduce((sum, row) => sum + row.qty, 0);
  lastPdfSalesTotal = totalSales;
  lastPdfQtyTotal = totalQty;
  const displaySales = sessionOrderSales;
  const avgUnit = totalQty && displaySales ? displaySales / totalQty : 0;
  const sortedByValue = [...products].sort((a, b) => b.amount - a.amount);
  const sortedByQty = [...products].sort((a, b) => b.qty - a.qty);
  const topProduct = sortedByValue[0];
  const topQtyProduct = sortedByQty[0];
  const dateMatch = allText.match(/\b20\d{2}-\d{2}-\d{2}\b/);
  const sessionMatch = allText.match(/POS\/\d+/);

  els.pageCount.textContent = numberFormatter.format(pageCount);
  els.totalSales.textContent = displaySales ? `${moneyFormatter.format(displaySales)} ر.س` : "ارفع صورة الجلسة";
  els.totalQty.textContent = numberFormatter.format(totalQty);
  els.productCount.textContent = numberFormatter.format(products.length);
  els.avgUnit.textContent = avgUnit ? `${moneyFormatter.format(avgUnit)} ر.س` : "-";
  els.topQty.textContent = topQtyProduct ? numberFormatter.format(topQtyProduct.qty) : "-";
  els.reportMeta.textContent = [dateMatch?.[0], sessionMatch?.[0]].filter(Boolean).join(" · ") || name;

  renderInsights({ pageCount, products, totalSales, totalQty, avgUnit, topProduct, topQtyProduct });
  renderChart(products);
  renderFocusCards(products);
  renderPriceBands(products);
  currentExtractPayload = { products, countProducts: allExtractProducts, totalSales, totalQty, date: dateMatch?.[0] };
  renderDailyExtract(currentExtractPayload);
  renderTable(products);
}

function updateDashboardSalesOverride() {
  if (!hasReport) return;
  const displaySales = sessionOrderSales;
  els.totalSales.textContent = displaySales ? `${moneyFormatter.format(displaySales)} ر.س` : "ارفع صورة الجلسة";
  if (lastPdfQtyTotal && displaySales) {
    els.avgUnit.textContent = `${moneyFormatter.format(displaySales / lastPdfQtyTotal)} ر.س`;
  } else {
    els.avgUnit.textContent = "-";
  }
}

function formatPlainMoney(value) {
  return extractNumberFormatter.format(value).replace(/\.(\d+)$/, ",$1");
}

function formatPlainNumber(value) {
  return extractNumberFormatter.format(value).replace(/\.(\d+)$/, ",$1");
}

function normalizeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function isReturnText(value) {
  return /return|refund|returned|reverse|reversal|مرتجع|مرتجعات|استرجاع|استرداد/i.test(normalizeDigits(value));
}

function isReturnPageText(value) {
  const text = normalizeDigits(value);
  return /\u0645\u0631\u062a\u062c\u0639|\u0645\u0631\u062a\u062c\u0639\u0627\u062a|\u0627\u0633\u062a\u0631\u062c\u0627\u0639|\u0627\u0633\u062a\u0631\u062f\u0627\u062f|\u0627\u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f\u0627\u062a/.test(text);
}

function extractInvoiceNumber(text, fallback = "N/A") {
  const normalized = normalizeDigits(text).replace(/\s+/g, " ");
  const patterns = [
    /\bPOS\/\d+\b/i,
    /\b(?:invoice|order|receipt|bill)\s*(?:no\.?|number|#|:)?\s*([A-Z0-9/-]+)/i,
    /(?:فاتورة|طلب|رقم\s+الفاتورة|رقم\s+الطلب)\s*[:#]?\s*([A-Z0-9/-]+)/i,
    /\b20\d{2}-\d{2}-\d{2}\b.*?\b(\d{4,})\b/,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return match[1] || match[0];
  }
  return fallback;
}

function pageTextForRow(row, pageTexts = [], rawPageTexts = []) {
  if (row.pageIndex === null || row.pageIndex === undefined) return "";
  return `${rawPageTexts[row.pageIndex] || ""}\n${pageTexts[row.pageIndex] || ""}`;
}

function discountCodeFromProduct(product) {
  const name = normalizeName(product);
  if (name.includes("per point on your order") || name.includes("order your on point per")) {
    return "100.01 per point on your order";
  }
  if (name.includes("per order on your order") || name.includes("order your on order per")) {
    return "100.01 per order on your order";
  }
  if (name.includes("on your order") || name.includes("order your on")) {
    return "on your order 100%";
  }
  return "";
}

function findOfferDiscountMatch(discountCode, totalDiscount) {
  const matches = OFFER_DISCOUNT_MAP.filter((offer) => normalizeName(offer.discountCode) === normalizeName(discountCode));
  for (const offer of matches) {
    const repeatCount = Math.round(totalDiscount / offer.unitDiscount);
    if (repeatCount < 1) continue;
    const expected = repeatCount * offer.unitDiscount;
    if (Math.abs(totalDiscount - expected) <= Math.max(0.03, repeatCount * 0.02)) {
      return { offer, repeatCount };
    }
  }
  return null;
}

function isDiscountRowForSummary(row, pageTexts = [], rawPageTexts = []) {
  const sourceText = `${row.rawText || ""} ${row.product || ""} ${pageTextForRow(row, pageTexts, rawPageTexts)}`;
  return (
    row.amount < 0 &&
    !isReturnText(sourceText) &&
    Boolean(discountCodeFromProduct(row.product)) &&
    isOrderDiscountName(row.product)
  );
}

function buildPdfOfferRowsSummary(rows, pageTexts = [], rawPageTexts = []) {
  const summary = {
    name: "on your order 100%",
    qty: 0,
    value: 0,
  };

  for (const row of rows) {
    const sourceText = `${row.rawText || ""} ${row.product || ""} ${pageTextForRow(row, pageTexts, rawPageTexts)}`;
    if (isReturnText(sourceText) || isReturnPageText(sourceText)) continue;
    if (discountCodeFromProduct(row.product) !== "on your order 100%") continue;
    if (row.amount >= 0) continue;
    summary.qty += row.qty || 0;
    summary.value += row.amount || 0;
  }

  summary.qty = Number(summary.qty.toFixed(2));
  summary.value = Number(summary.value.toFixed(2));
  return summary.qty > 0 ? [summary] : [];
}

function extractNegativeOfferAmount(text) {
  const normalized = normalizeDigits(text);
  const matches = [
    ...normalized.matchAll(/-\s*([\d,]+\.\d{2})/g),
    ...normalized.matchAll(/([\d,]+\.\d{2})\s*-/g),
  ]
    .map((match) => Number((match[1] || "").replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0);
  return matches.length ? -Math.max(...matches) : null;
}

function extractOfferQtyFromText(text, amount) {
  const amountAbs = Math.abs(amount || 0);
  const values = [...normalizeDigits(text).matchAll(/(?:^|\s)(\d+(?:\.\d)?)(?:\s|$)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => {
      return (
        Number.isFinite(value) &&
        value > 0 &&
        value < 10000 &&
        Math.abs(value - 100) > 0.01 &&
        Math.abs(value - amountAbs) > 0.01
      );
    });
  return values.length ? Math.max(...values) : null;
}

function closestNegativeOfferAmount(text, anchorIndex) {
  const normalized = normalizeDigits(text);
  const matches = [
    ...normalized.matchAll(/-\s*([\d,]+\.\d{2})/g),
    ...normalized.matchAll(/([\d,]+\.\d{2})\s*-/g),
  ]
    .map((match) => ({
      value: -Number((match[1] || "").replace(/,/g, "")),
      distance: Math.abs(match.index - anchorIndex),
    }))
    .filter((match) => Number.isFinite(match.value) && match.value < 0)
    .sort((a, b) => a.distance - b.distance);
  return matches[0]?.value ?? null;
}

function closestOfferQty(text, anchorIndex, amount) {
  const amountAbs = Math.abs(amount || 0);
  const matches = [...normalizeDigits(text).matchAll(/(?:^|\s)(\d+(?:\.\d)?)(?:\s|$)/g)]
    .map((match) => ({
      value: Number(match[1]),
      distance: Math.abs(match.index - anchorIndex),
    }))
    .filter((match) => {
      return (
        Number.isFinite(match.value) &&
        match.value > 0 &&
        match.value < 10000 &&
        Math.abs(match.value - 100) > 0.01 &&
        Math.abs(match.value - amountAbs) > 0.01
      );
    })
    .sort((a, b) => a.distance - b.distance);
  return matches[0]?.value ?? null;
}

function addOfferSummaryLine(summary, seen, pageIndex, line, keySuffix = "") {
  if (!/on\s+your\s+order\s+100\s*%/i.test(line)) return false;
  if (isReturnText(line) || isReturnPageText(line)) return false;
  const amount = extractNegativeOfferAmount(line);
  if (amount === null) return false;
  const qty = extractOfferQtyFromText(line, amount);
  if (qty === null) return false;
  const dedupeKey = `${pageIndex}|line|${qty}|${amount.toFixed(2)}|${keySuffix || line}`;
  if (seen.has(dedupeKey)) return true;
  seen.add(dedupeKey);
  summary.qty += qty;
  summary.value += amount;
  return true;
}

function extractPdfOfferRowsSummaryFromText(pageTexts = [], rawPageTexts = []) {
  const summary = {
    name: "on your order 100%",
    qty: 0,
    value: 0,
  };
  const seen = new Set();
  const pageCount = Math.max(pageTexts.length, rawPageTexts.length);

  for (let index = 0; index < pageCount; index += 1) {
    const pageText = `${rawPageTexts[index] || ""}\n${pageTexts[index] || ""}`;
    if (isReturnText(pageText) || isReturnPageText(pageText)) continue;

    const normalized = normalizeDigits(pageText).replace(/\u200b/g, " ");
    let matchedLine = false;
    const lines = normalized
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (!/on\s+your\s+order\s+100\s*%/i.test(line)) continue;
      const candidates = [
        line,
        `${lines[lineIndex - 1] || ""} ${line}`.trim(),
        `${line} ${lines[lineIndex + 1] || ""}`.trim(),
        `${lines[lineIndex - 1] || ""} ${line} ${lines[lineIndex + 1] || ""}`.trim(),
        `${lines[lineIndex - 2] || ""} ${lines[lineIndex - 1] || ""} ${line}`.trim(),
        `${line} ${lines[lineIndex + 1] || ""} ${lines[lineIndex + 2] || ""}`.trim(),
      ].filter(Boolean);
      for (const candidate of candidates) {
        if (addOfferSummaryLine(summary, seen, index, candidate, `${lineIndex}|${candidate}`)) {
          matchedLine = true;
          break;
        }
      }
    }
    if (matchedLine) continue;

    const pattern = /on\s+your\s+order\s+100\s*%/gi;
    let match;
    while ((match = pattern.exec(normalized)) !== null) {
      const start = Math.max(0, match.index - 140);
      const end = Math.min(normalized.length, match.index + match[0].length + 140);
      const segment = normalized.slice(start, end);
      if (isReturnText(segment) || isReturnPageText(segment)) continue;

      const amount = closestNegativeOfferAmount(segment, match.index - start);
      if (amount === null) continue;
      const qty = closestOfferQty(segment, match.index - start, amount);
      if (qty === null) continue;

      const dedupeKey = `${index}|${qty}|${amount.toFixed(2)}|${match.index}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      summary.qty += qty;
      summary.value += amount;
    }
  }

  summary.qty = Number(summary.qty.toFixed(2));
  summary.value = Number(summary.value.toFixed(2));
  return summary.qty > 0 ? [summary] : [];
}

function buildOfferAndDiscountSummaries(rows, pageTexts = [], rawPageTexts = []) {
  const groups = new Map();
  const seen = new Set();

  for (const row of rows) {
    if (!isDiscountRowForSummary(row, pageTexts, rawPageTexts)) continue;
    const discountCode = discountCodeFromProduct(row.product);
    const invoiceNumber = extractInvoiceNumber(pageTextForRow(row, pageTexts, rawPageTexts), `Page ${Number(row.pageIndex ?? 0) + 1}`);
    const discountAmount = Math.abs(row.amount);
    const dedupeKey = `${invoiceNumber}|${discountCode}|${discountAmount.toFixed(2)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const groupKey = `${invoiceNumber}|${discountCode}`;
    const group =
      groups.get(groupKey) ||
      {
        invoiceNumber,
        discountCode,
        totalDiscount: 0,
      };
    group.totalDiscount += discountAmount;
    groups.set(groupKey, group);
  }

  const offers = [];
  const unmatchedDiscounts = [];
  for (const group of groups.values()) {
    const roundedTotal = Number(group.totalDiscount.toFixed(2));
    const match = findOfferDiscountMatch(group.discountCode, roundedTotal);
    if (match) {
      offers.push({
        offerName: match.offer.offerName,
        discountCode: group.discountCode,
        invoiceNumber: group.invoiceNumber,
        unitDiscount: match.offer.unitDiscount,
        totalDiscount: roundedTotal,
        repeatCount: match.repeatCount,
        bundleKey: match.offer.bundleKey,
      });
    } else {
      unmatchedDiscounts.push({
        discountCode: group.discountCode,
        invoiceNumber: group.invoiceNumber,
        totalDiscount: roundedTotal,
      });
    }
  }

  return { offers, unmatchedDiscounts };
}

function isOfferDiscount(row) {
  const name = normalizeName(row.product);
  return (
    name.includes("on your order") ||
    name.includes("order your on") ||
    name.includes("per point") ||
    name.includes("point per") ||
    name.includes("per order") ||
    name.includes("order 100") ||
    name.includes("discount")
  );
}

function isOrderDiscountName(product) {
  const name = normalizeName(product);
  return name.includes("on your order") || name.includes("order your on");
}

function isOrder100DiscountName(product) {
  const name = normalizeName(product);
  const hasOrderDiscount = name.includes("on your order") || name.includes("order your on");
  const hasPointDiscount = name.includes("per point") || name.includes("point per");
  return hasOrderDiscount && !hasPointDiscount;
}

function isMmtBundleName(product) {
  const name = normalizeName(product);
  return (
    name.includes("per point on your order") ||
    name.includes("per order on your order") ||
    name.includes("order your on point per") ||
    name.includes("order your on order per")
  );
}

function isReviewedOffer(row) {
  return isOrder100DiscountName(row.product) || isMmtBundleName(row.product);
}

function discountUnitMatches(row, target) {
  return row.qty ? Math.abs(Math.abs(row.amount / row.qty) - target) < 0.02 : false;
}

function sumQtyByKeywords(products, keywords) {
  return products
    .filter((row) => {
      const name = normalizeName(row.product);
      return keywords.some((keyword) => name.includes(keyword));
    })
    .reduce((sum, row) => sum + row.qty, 0);
}

const dailyProductMap = {
  discoveryBlack: {
    barcodes: ["6287020284793"],
    names: ["match collection match discovery set d4"],
  },
  tawziatCollection: {
    barcodes: ["6287020286155"],
    names: ["match towziyat box pack 20 ml 10 in 1"],
  },
  muskCollection: {
    barcodes: ["6287020284809"],
    names: ["match musk collection 20ml 9in1"],
  },
  d5Box: {
    barcodes: ["6287020285042"],
    names: ["match collection match discovery set ramadan d5"],
  },
  tawziyatBoxSolo: {
    barcodes: ["6287020286926"],
    names: ["tawziyat box solo"],
  },
};

const makeupBarcodes = [
  "6287020283857",
  "6287020283864",
  "6287020283871",
  "6287020283888",
  "6287020283895",
  "6287020283301",
  "6287020283918",
  "6287020283925",
  "6287020283932",
  "6287020284076",
  "6287020284083",
  "6287020284090",
  "6287020284106",
  "6287020284113",
  "6287020284120",
  "6287020284236",
  "6287020284243",
  "6287020284939",
  "6287020284946",
  "6287020284922",
  "6287020284915",
];

function productMatches(row, rule) {
  if (rule.barcodes.includes(row.barcode)) return true;
  const name = normalizeName(row.product);
  return rule.names.some((target) => name.includes(normalizeName(target)));
}

function sumQtyByMappedProduct(products, key) {
  const rule = dailyProductMap[key];
  return products
    .filter((row) => productMatches(row, rule))
    .reduce((sum, row) => sum + row.qty, 0);
}

function sumAmountByBarcodes(products, barcodes) {
  const barcodeSet = new Set(barcodes);
  return products
    .filter((row) => barcodeSet.has(row.barcode))
    .reduce((sum, row) => sum + row.amount, 0);
}

function extractMappedDailyQuantities(text) {
  const quantities = {};
  for (const [key, rule] of Object.entries(dailyProductMap)) {
    quantities[key] = 0;
    for (const barcode of rule.barcodes) {
      const escaped = barcode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`${escaped}[\\s\\S]{0,180}?(\\d+(?:\\.\\d+)?)\\s*\\n?\\s*تاﺪﺣﻮﻟا`, "g");
      let match;
      while ((match = pattern.exec(text)) !== null) {
        quantities[key] += Number(match[1]);
      }
    }
  }
  return quantities;
}

function extractDiscountBundleCounts(text) {
  const rows = [];
  const normalized = text.replace(/\u200b/g, " ");
  const productFirst = /on\s+your\s+order\s+100%[\s\S]{0,80}?(\d+(?:\.\d+)?)\s*تاﺪﺣﻮﻟا[\s\S]{0,80}?-\s*([\d,]+\.\d{2})/g;
  const amountFirst = /-\s*([\d,]+\.\d{2})[\s\S]{0,80}?(\d+(?:\.\d+)?)\s*تاﺪﺣﻮﻟا[\s\S]{0,80}?on\s+your\s+order\s+100%/g;
  let match;
  while ((match = productFirst.exec(normalized)) !== null) {
    rows.push({ qty: Number(match[1]), amount: Number(match[2].replace(/,/g, "")) });
  }
  while ((match = amountFirst.exec(normalized)) !== null) {
    rows.push({ qty: Number(match[2]), amount: Number(match[1].replace(/,/g, "")) });
  }
  return {
    pinkMusk: rows
      .filter((row) => discountUnitMatches(row, 46.09))
      .reduce((sum, row) => sum + row.qty, 0),
    discoveryWinter: rows
      .filter((row) => discountUnitMatches(row, 67.83))
      .reduce((sum, row) => sum + row.qty, 0),
    magicD5: 0,
    mmt: rows
      .filter((row) => discountUnitMatches(row, 100.01))
      .reduce((sum, row) => sum + row.qty, 0),
  };
}

function extractDiscountBundleCountsFromRows(rows) {
  return {
    pinkMusk: rows
      .filter((row) => isOrderDiscountName(row.product))
      .filter((row) => discountUnitMatches(row, 46.09))
      .reduce((sum, row) => sum + row.qty, 0),
    discoveryWinter: rows
      .filter((row) => isOrderDiscountName(row.product))
      .filter((row) => discountUnitMatches(row, 67.83))
      .reduce((sum, row) => sum + row.qty, 0),
    magicD5: rows
      .filter((row) => isOrder100DiscountName(row.product))
      .filter((row) => discountUnitMatches(row, 21.74))
      .reduce((sum, row) => sum + row.qty, 0),
    mmt: rows
      .filter((row) => isMmtBundleName(row.product))
      .filter((row) => discountUnitMatches(row, 100.01))
      .reduce((sum, row) => sum + row.qty, 0),
  };
}

function mergeDiscountBundleCounts(...counts) {
  return {
    pinkMusk: Math.max(...counts.map((count) => count.pinkMusk || 0)),
    discoveryWinter: Math.max(...counts.map((count) => count.discoveryWinter || 0)),
    magicD5: Math.max(...counts.map((count) => count.magicD5 || 0)),
    mmt: Math.max(...counts.map((count) => count.mmt || 0)),
  };
}

function formatDateForExtract(dateText) {
  if (!dateText) return "N/A";
  const [year, month, day] = dateText.split("-");
  return `${day} / ${month} / ${year}`;
}

function renderDailyExtract({ products, countProducts, totalSales, totalQty, date }) {
  const fallbackAt = products.length;
  const orders = sessionOrderTotal;
  const salesForAdt = sessionOrderSales || 0;
  const adt = orders || fallbackAt;
  const at = adt ? salesForAdt / adt : 0;
  const pdfQuantityTotal = pdfGrandQuantityTotal ?? aiPdfTotalQty ?? totalQty;
  const pink = sumQtyByKeywords(countProducts, ["pink", "pinko"]);
  const muskCollection = sumQtyByMappedProduct(countProducts, "muskCollection");
  const pinkMuskBundle = discountBundleCounts.pinkMusk ?? 0;
  const discoveryBlack = sumQtyByMappedProduct(countProducts, "discoveryBlack");
  const winterCollection = sumQtyByKeywords(countProducts, ["winter collection"]);
  const discoveryWinterBundle = discountBundleCounts.discoveryWinter ?? 0;
  const magicLayering = sumQtyByKeywords(countProducts, ["magic", "layering"]);
  const d5Box = sumQtyByMappedProduct(countProducts, "d5Box");
  const magicD5Bundle = discountBundleCounts.magicD5 ?? 0;
  const tawziat = sumQtyByMappedProduct(countProducts, "tawziatCollection");
  const mmtBundle = discountBundleCounts.mmt ?? 0;
  const makeupSales = sumAmountByBarcodes(countProducts, makeupBarcodes);
  const tawziyatBoxSolo = sumQtyByMappedProduct(countProducts, "tawziyatBoxSolo");
  const d1Box = sumQtyByMappedProduct(countProducts, "d1Box");
  const offersQty = offersSummary.reduce((sum, offer) => sum + offer.qty, 0);
  offerDiscountQuantityTotal = offersQty;
  const uptBaseQty = Math.max(0, pdfQuantityTotal - offersQty);
  const upt = adt ? uptBaseQty / adt : 0;

  currentExtractText = `● ALMAHMAL ●

${formatDateForExtract(date)}

- Sales : ${formatPlainMoney(salesForAdt)}
- ADT : ${formatPlainNumber(adt)}
- AT : ${formatPlainNumber(at)}
- UPT : ${formatPlainNumber(upt)}
- Cash : N/A
------------------
- Pinkoctober :${formatPlainNumber(pink)}
- Musk collection :${formatPlainNumber(muskCollection)}
- Bundle (P+M) :${formatPlainNumber(pinkMuskBundle)}
------------------
- Discovery Black :${formatPlainNumber(discoveryBlack)}
- Winter collection :${formatPlainNumber(winterCollection)}
- Bundle ( D + W) :${formatPlainNumber(discoveryWinterBundle)}
------------------
- Magic of Layering : ${formatPlainNumber(magicLayering)}
- D5 Box :${formatPlainNumber(d5Box)}
- Bundle(M+D) : ${formatPlainNumber(magicD5Bundle)}
------------------
- Tawziat collection :${formatPlainNumber(tawziat)}
- MMT Bundle : ${formatPlainNumber(mmtBundle)}
------------------
- D1 :${formatPlainNumber(d1Box)}
- MAKEUP SALES  : ${makeupSales ? formatPlainMoney(makeupSales) : "0"}
Tawziyat Box solo : ${formatPlainNumber(tawziyatBoxSolo)}
------------------
- Jahez sales  : N/A
- ADT :N/A`;

  els.dailyExtract.textContent = currentExtractText;
  renderCalculationReview({ pdfQuantityTotal, offerQty: offerDiscountQuantityTotal, adt, at, uptBaseQty, upt });
  renderOfferSummaryRows();
}

function renderCalculationReview({ pdfQuantityTotal, offerQty, adt, at, uptBaseQty, upt }) {
  els.calculationReview.innerHTML = `
    <div class="calc-line">
      <span>UPT</span>
      <strong>(${formatPlainNumber(pdfQuantityTotal)} - ${formatPlainNumber(offerQty)}) ÷ ${formatPlainNumber(adt)} = ${formatPlainNumber(upt)}</strong>
    </div>
    <div class="calc-grid">
      <div><span>إجمالي كمية PDF</span><strong>${formatPlainNumber(pdfQuantityTotal)}</strong></div>
      <div><span>كمية العروض</span><strong>${formatPlainNumber(offerQty)}</strong></div>
      <div><span>بعد الطرح</span><strong>${formatPlainNumber(uptBaseQty)}</strong></div>
      <div><span>ADT</span><strong>${formatPlainNumber(adt)}</strong></div>
      <div><span>AT</span><strong>${formatPlainNumber(at)}</strong></div>
    </div>
  `;
}

function getOfferLabel(row) {
  if (!isMmtBundleName(row.product)) return "on your order 100%";
  return normalizeName(row.product).includes("per order") ? "100.01 per order on your order" : "100.01 per point on your order";
}

function renderOfferRows() {
  els.offerRowsBody.innerHTML = "";
  if (!offerReviewRows.length) {
    els.offerRowsBody.innerHTML = "<tr><td colspan='3'>لا توجد عروض مطابقة داخل PDF.</td></tr>";
    return;
  }

  for (const row of offerReviewRows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(getOfferLabel(row))}</td>
      <td>${formatPlainNumber(row.qty)}</td>
      <td>${moneyFormatter.format(row.amount)} ر.س</td>
    `;
    els.offerRowsBody.appendChild(tr);
  }

  const total = document.createElement("tr");
  total.className = "offer-total-row";
  total.innerHTML = `
    <td>الإجمالي</td>
    <td>${formatPlainNumber(offerDiscountQuantityTotal)}</td>
    <td>${moneyFormatter.format(offerReviewRows.reduce((sum, row) => sum + row.amount, 0))} ر.س</td>
  `;
  els.offerRowsBody.appendChild(total);
}

function renderOfferSummaryRows() {
  els.offerRowsBody.innerHTML = "";
  if (els.discountRowsBody) {
    els.discountRowsBody.innerHTML = "<tr><td colspan='3'></td></tr>";
  }
  if (!offersSummary.length) {
    els.offerRowsBody.innerHTML = "<tr><td colspan='3'>لا توجد عروض مطابقة داخل PDF</td></tr>";
  } else {
    for (const row of offersSummary) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(row.name)}</td>
        <td>${formatPlainNumber(row.qty)}</td>
        <td>${moneyFormatter.format(row.value)} ر.س</td>
        <td>${moneyFormatter.format(row.unitDiscount)} Ø±.Ø³</td>
        <td>${moneyFormatter.format(row.totalDiscount)} Ø±.Ø³</td>
        <td>${formatPlainNumber(row.repeatCount)}</td>
      `;
      tr.innerHTML = `
        <td>${escapeHtml(row.name)}</td>
        <td>${formatPlainNumber(row.qty)}</td>
        <td>${moneyFormatter.format(row.value)} ر.س</td>
      `;
      els.offerRowsBody.appendChild(tr);
    }

    const total = document.createElement("tr");
    total.className = "offer-total-row";
    total.innerHTML = `
      <td colspan="4">Ø§Ù„Ø¥Ø¬Ù…Ø§Ù„ÙŠ</td>
      <td>${moneyFormatter.format(offerReviewRows.reduce((sum, row) => sum + row.totalDiscount, 0))} Ø±.Ø³</td>
      <td>${formatPlainNumber(offerDiscountQuantityTotal)}</td>
    `;
    total.innerHTML = `
      <td>الإجمالي</td>
      <td>${formatPlainNumber(offersSummary.reduce((sum, row) => sum + row.qty, 0))}</td>
      <td>${moneyFormatter.format(offersSummary.reduce((sum, row) => sum + row.value, 0))} ر.س</td>
    `;
    els.offerRowsBody.appendChild(total);
  }

  return;
  if (!els.discountRowsBody) return;
  els.discountRowsBody.innerHTML = "";
  if (!discountReviewRows.length) {
    els.discountRowsBody.innerHTML = "<tr><td colspan='3'>No unmatched discounts.</td></tr>";
    return;
  }

  for (const row of discountReviewRows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(row.discountCode)}</td>
      <td>${escapeHtml(row.invoiceNumber)}</td>
      <td>${moneyFormatter.format(row.totalDiscount)} Ø±.Ø³</td>
    `;
    els.discountRowsBody.appendChild(tr);
  }
}

function updateOrders(value) {
  sessionOrderTotal = Number(value) > 0 ? Number(value) : null;
  if (currentExtractPayload) renderDailyExtract(currentExtractPayload);
}

function updateOrderSales(value) {
  sessionOrderSales = Number(value) > 0 ? Number(value) : null;
  updateDashboardSalesOverride();
  if (currentExtractPayload) renderDailyExtract(currentExtractPayload);
}

function renderInsights({ pageCount, products, totalSales, totalQty, avgUnit, topProduct, topQtyProduct }) {
  const valueShare = topProduct && totalSales ? (topProduct.amount / totalSales) * 100 : 0;
  const qtyShare = topQtyProduct && totalQty ? (topQtyProduct.qty / totalQty) * 100 : 0;
  const messages = [
    `تم استخراج ${numberFormatter.format(products.length)} بند مبيعات من ${numberFormatter.format(pageCount)} صفحات، مع إجمالي كمية ${numberFormatter.format(totalQty)} وحدة.`,
    topProduct
      ? `أعلى بند قيمة هو ${topProduct.product} ويمثل تقريبًا ${numberFormatter.format(valueShare)}٪ من إجمالي المبيعات.`
      : "لم يتم العثور على بنود قابلة للتحليل داخل الملف.",
    topQtyProduct
      ? `أعلى بند في الحركة الكمية هو ${topQtyProduct.product} بعدد ${numberFormatter.format(topQtyProduct.qty)} وحدة، بنسبة ${numberFormatter.format(qtyShare)}٪ من الكمية.`
      : "لا توجد كميات كافية لحساب أعلى بند كمية.",
    avgUnit ? `متوسط قيمة الوحدة التقريبي ${moneyFormatter.format(avgUnit)} ر.س، ويمكن استخدامه لمراقبة تغيرات التسعير بين التقارير.` : "لا توجد كميات كافية لحساب متوسط الوحدة.",
  ];

  els.insights.innerHTML = "";
  for (const text of messages) {
    const item = document.createElement("div");
    item.className = "insight";
    item.textContent = text;
    els.insights.appendChild(item);
  }
}

function renderChart(products) {
  const top = [...products].sort((a, b) => b.amount - a.amount).slice(0, 8);
  const max = top[0]?.amount || 1;
  els.barChart.innerHTML = "";

  if (!top.length) {
    els.barChart.innerHTML = "<p class='muted'>لا توجد بيانات كافية للرسم.</p>";
    return;
  }

  for (const row of top) {
    const item = document.createElement("div");
    item.className = "bar-row";
    item.innerHTML = `
      <div>
        <div class="bar-label" title="${escapeHtml(row.product)}">${escapeHtml(row.product)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(5, (row.amount / max) * 100)}%"></div></div>
      </div>
      <div class="bar-value">${moneyFormatter.format(row.amount)}</div>
    `;
    els.barChart.appendChild(item);
  }
}

function renderFocusCards(products) {
  const byValue = [...products].sort((a, b) => b.amount - a.amount)[0];
  const byQty = [...products].sort((a, b) => b.qty - a.qty)[0];
  const byUnit = [...products].sort((a, b) => b.unitPrice - a.unitPrice)[0];
  const cards = [
    byValue && { label: "أعلى قيمة مبيعات", title: byValue.product, value: `${moneyFormatter.format(byValue.amount)} ر.س` },
    byQty && { label: "أعلى حركة كمية", title: byQty.product, value: `${numberFormatter.format(byQty.qty)} وحدة` },
    byUnit && { label: "أعلى سعر وحدة", title: byUnit.product, value: `${moneyFormatter.format(byUnit.unitPrice)} ر.س` },
  ].filter(Boolean);

  els.focusCards.innerHTML = "";
  if (!cards.length) {
    els.focusCards.innerHTML = "<div class='focus-card'>لا توجد بيانات كافية.</div>";
    return;
  }

  for (const card of cards) {
    const item = document.createElement("div");
    item.className = "focus-card";
    item.innerHTML = `
      <span>${card.label}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <p>${card.value}</p>
    `;
    els.focusCards.appendChild(item);
  }
}

function renderPriceBands(products) {
  const bands = [
    { label: "أقل من 100 ر.س", test: (row) => row.amount < 100 },
    { label: "100 إلى 300 ر.س", test: (row) => row.amount >= 100 && row.amount < 300 },
    { label: "300 ر.س فأكثر", test: (row) => row.amount >= 300 },
  ].map((band) => ({
    ...band,
    count: products.filter(band.test).length,
  }));
  const max = Math.max(...bands.map((band) => band.count), 1);

  els.priceBands.innerHTML = "";
  for (const band of bands) {
    const item = document.createElement("div");
    item.className = "band";
    item.innerHTML = `
      <span>${band.label}</span>
      <strong>${numberFormatter.format(band.count)} منتج</strong>
      <div class="band-meter"><i style="width:${Math.max(4, (band.count / max) * 100)}%"></i></div>
    `;
    els.priceBands.appendChild(item);
  }
}

function renderTable(products) {
  const term = els.search.value.trim().toLowerCase();
  const filtered = products.filter((row) => {
    const haystack = `${row.product} ${row.barcode}`.toLowerCase();
    return haystack.includes(term);
  });

  els.productsBody.innerHTML = "";
  if (!filtered.length) {
    els.productsBody.innerHTML = "<tr><td colspan='6'>لا توجد نتائج مطابقة.</td></tr>";
    return;
  }

  filtered.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${escapeHtml(row.product)}</td>
      <td>${escapeHtml(row.barcode || "-")}</td>
      <td>${numberFormatter.format(row.qty)}</td>
      <td>${moneyFormatter.format(row.unitPrice)} ر.س</td>
      <td>${moneyFormatter.format(row.amount)} ر.س</td>
    `;
    els.productsBody.appendChild(tr);
  });
}

els.input.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const bytes = await file.arrayBuffer();
    lastPdfBytes = bytes.slice(0);
    lastPdfName = file.name;
    await analyzePdf({ data: bytes }, file.name);
  } catch (error) {
    console.error(error);
    setOcrRetryVisible(Boolean(lastPdfBytes));
    document.body.classList.add("has-report");
    setStatus(`تعذر تحليل الملف. السبب: ${error?.message || "غير معروف"}. جرّب زر إعادة التحليل OCR أو أعد تصدير PDF بجودة أوضح.`, "error");
  }
});

els.ocrRetryButton.addEventListener("click", async () => {
  if (!lastPdfBytes) return;

  try {
    await analyzePdf({ data: lastPdfBytes.slice(0) }, lastPdfName || "PDF", { forceOcr: true });
  } catch (error) {
    console.error(error);
    setOcrRetryVisible(true);
    document.body.classList.add("has-report");
    setStatus(`فشل OCR أيضًا. السبب: ${error?.message || "غير معروف"}. جرّب PDF أوضح أو افتح الملف ثم صدّره PDF من جديد.`, "error");
  }
});

els.search.addEventListener("input", () => renderTable(allProducts));

els.ordersInput.addEventListener("input", () => {
  updateOrders(els.ordersInput.value);
});

els.orderSalesInput.addEventListener("input", () => {
  updateOrderSales(els.orderSalesInput.value);
});

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab-button").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".app-view").forEach((view) => view.classList.remove("active"));
    button.classList.add("active");
    document.querySelector(`#${button.dataset.view}`).classList.add("active");
  });
});

els.copyExtract.addEventListener("click", async () => {
  if (!currentExtractText) return;
  await navigator.clipboard.writeText(currentExtractText);
  const original = els.copyExtract.textContent;
  els.copyExtract.textContent = "تم النسخ";
  window.setTimeout(() => {
    els.copyExtract.textContent = original;
  }, 1400);
});

async function boot() {
  resetEmptyState();
}

boot();
