import * as pdfjsLib from "./vendor/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";

const defaultPdfName = "تفاصيل المبيعات (3).pdf";
const els = {
  input: document.querySelector("#pdfInput"),
  fileName: document.querySelector("#fileName"),
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
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
  sessionImageInput: document.querySelector("#sessionImageInput"),
  sessionImagePreview: document.querySelector("#sessionImagePreview"),
  ordersInput: document.querySelector("#ordersInput"),
  ocrStatus: document.querySelector("#ocrStatus"),
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

let allProducts = [];
let allExtractProducts = [];
let currentExtractText = "";
let currentExtractPayload = null;
let sessionOrderTotal = null;

function setStatus(text, type = "ready") {
  els.statusText.textContent = text;
  els.statusDot.className = `status-dot ${type === "ready" ? "" : type}`;
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

function parseAmount(value) {
  const match = value.replace(/[﷼]/g, "").match(/[\d,]+\.\d{2}/);
  return match ? Number(match[0].replace(/,/g, "")) : null;
}

function parseQty(value) {
  const match = value.match(/(?:^|\s)(\d+(?:\.\d)?)(?:\s|$)/);
  return match ? Number(match[1]) : null;
}

function extractBarcode(value) {
  const match = value.match(/\[\s*(\d{8,})\s*\]|\]\s*(\d{8,})\s*\[|(\d{8,})/);
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
  const qtyCandidates = line.items
    .map((item) => parseQty(item.text))
    .filter((value) => value !== null && value < 10000);
  const qty = qtyCandidates.find((value) => !amount || Math.abs(value - amount) > 0.01) ?? null;
  const barcode = extractBarcode(text);

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
  return { product, barcode, qty, amount, unitPrice: amount / qty };
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

async function analyzePdf(source, name) {
  setStatus("جاري قراءة الصفحات واستخراج جدول المبيعات والمؤشرات التفصيلية...", "loading");
  els.fileName.textContent = name;
  els.previewLabel.textContent = "الصفحة الأولى";

  const loadingTask = pdfjsLib.getDocument(source);
  const pdf = await loadingTask.promise;
  await renderPreview(pdf);
  const rows = [];
  const pageTexts = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines = groupItemsByLine(content.items);
    pageTexts.push(lines.map((line) => line.text).join(" "));
    for (const line of lines) {
      const row = rowFromLine(line);
      if (row) rows.push(row);
    }
  }

  allExtractProducts = mergeContinuationRows(rows);
  allProducts = allExtractProducts.filter((row) => row.amount > 0);
  renderDashboard(pdf.numPages, allProducts, pageTexts.join(" "), name);
  setStatus("تم تحليل التقرير بنجاح. الواجهة تعرض الآن مؤشرات تفصيلية قابلة للبحث والمراجعة.", "ready");
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
  const avgUnit = totalQty ? totalSales / totalQty : 0;
  const sortedByValue = [...products].sort((a, b) => b.amount - a.amount);
  const sortedByQty = [...products].sort((a, b) => b.qty - a.qty);
  const topProduct = sortedByValue[0];
  const topQtyProduct = sortedByQty[0];
  const dateMatch = allText.match(/\b20\d{2}-\d{2}-\d{2}\b/);
  const sessionMatch = allText.match(/POS\/\d+/);

  els.pageCount.textContent = numberFormatter.format(pageCount);
  els.totalSales.textContent = `${moneyFormatter.format(totalSales)} ر.س`;
  els.totalQty.textContent = numberFormatter.format(totalQty);
  els.productCount.textContent = numberFormatter.format(products.length);
  els.avgUnit.textContent = totalQty ? `${moneyFormatter.format(avgUnit)} ر.س` : "-";
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

function formatPlainMoney(value) {
  return extractNumberFormatter.format(value).replace(/\.(\d+)$/, ",$1");
}

function formatPlainNumber(value) {
  return extractNumberFormatter.format(value).replace(/\.(\d+)$/, ",$1");
}

function formatPlainInteger(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function normalizeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function sumQtyByKeywords(products, keywords) {
  return products
    .filter((row) => {
      const name = normalizeName(row.product);
      return keywords.some((keyword) => name.includes(keyword));
    })
    .reduce((sum, row) => sum + row.qty, 0);
}

function sumAmountByKeywords(products, keywords) {
  return products
    .filter((row) => {
      const name = normalizeName(row.product);
      return keywords.some((keyword) => name.includes(keyword));
    })
    .reduce((sum, row) => sum + row.amount, 0);
}

function formatDateForExtract(dateText) {
  if (!dateText) return "N/A";
  const [year, month, day] = dateText.split("-");
  return `${day} / ${month} / ${year}`;
}

function renderDailyExtract({ products, countProducts, totalSales, totalQty, date }) {
  const fallbackAt = products.length;
  const orders = sessionOrderTotal;
  const adt = orders ? totalSales / orders : fallbackAt ? totalSales / fallbackAt : 0;
  const at = orders && adt ? orders / adt : fallbackAt;
  const upt = orders ? totalQty / orders : at ? totalQty / at : 0;
  const pink = sumQtyByKeywords(countProducts, ["pink", "pinko"]);
  const muskCollection = sumQtyByKeywords(countProducts, ["musk collection"]);
  const discoveryBlack = sumQtyByKeywords(countProducts, ["discovery black"]);
  const winterCollection = sumQtyByKeywords(countProducts, ["winter collection"]);
  const magicLayering = sumQtyByKeywords(countProducts, ["magic", "layering"]);
  const d5Box = sumQtyByKeywords(countProducts, ["d5"]);
  const tawziat = sumQtyByKeywords(countProducts, ["tawziat", "towziyat", "tawziyat"]);
  const mmtBundle = sumQtyByKeywords(countProducts, ["mmt"]);
  const makeupSales = sumAmountByKeywords(countProducts, ["makeup", "make up"]);
  const tawziyatBoxSolo = sumQtyByKeywords(countProducts, ["tawziyat box", "tawziat box", "towziyat"]);

  currentExtractText = `● ALMAHMAL ●

${formatDateForExtract(date)}

- Sales : ${formatPlainMoney(totalSales)}
- ADT : ${formatPlainNumber(adt)}
- AT : ${formatPlainNumber(at)}
- UPT : ${formatPlainNumber(upt)}
- Cash : N/A
------------------
- Pinkoctober :${formatPlainNumber(pink)}
- Musk collection :${formatPlainNumber(muskCollection)}
- Bundle (P+M) :${formatPlainNumber(Math.min(pink, muskCollection))}
------------------
- Discovery Black :${formatPlainNumber(discoveryBlack)}
- Winter collection :${formatPlainNumber(winterCollection)}
- Bundle ( D + W) :${formatPlainNumber(Math.min(discoveryBlack, winterCollection))}
------------------
- Magic of Layering : ${formatPlainNumber(magicLayering)}
- D5 Box :${formatPlainNumber(d5Box)}
- Bundle(M+D) : ${formatPlainNumber(Math.min(magicLayering, d5Box))}
------------------
- Tawziat collection :${formatPlainNumber(tawziat)}
- MMT Bundle : ${formatPlainNumber(mmtBundle)}
------------------
- MAKEUP SALES  : ${makeupSales ? formatPlainMoney(makeupSales) : "0"}
Tawziyat Box solo : ${formatPlainNumber(tawziyatBoxSolo)}
------------------
- Jahez sales  : N/A
- ADT :N/A`;

  els.dailyExtract.textContent = currentExtractText;
}

function parseOrderTotalFromOcr(text) {
  const normalized = text.replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit));
  const labelMatch = normalized.match(/(?:orders?|order|الطلبات|طلبات)\D{0,24}(\d{1,5})|(\d{1,5})\D{0,24}(?:orders?|order|الطلبات|طلبات)/i);
  if (labelMatch) return Number(labelMatch[1] || labelMatch[2]);

  const integers = [...normalized.matchAll(/(?<![.,])\b\d{1,5}\b(?![.,]\d)/g)]
    .map((match) => Number(match[0]))
    .filter((value) => value > 0 && value < 10000);
  if (!integers.length) return null;

  const likelySmallCounts = integers.filter((value) => value <= 500);
  return likelySmallCounts.at(-1) ?? integers.at(-1);
}

function updateOrders(value) {
  sessionOrderTotal = Number(value) > 0 ? Number(value) : null;
  if (currentExtractPayload) renderDailyExtract(currentExtractPayload);
}

async function recognizeSessionImage(file) {
  els.ocrStatus.textContent = "جاري قراءة الصورة واستخراج إجمالي الطلبات...";
  const { createWorker } = await import("./vendor/tesseract.esm.min.js");
  const worker = await createWorker("eng", 1, {
    workerPath: "./vendor/tesseract-worker.min.js",
    logger: (message) => {
      if (message.status === "recognizing text") {
        els.ocrStatus.textContent = `جاري قراءة الصورة... ${Math.round((message.progress || 0) * 100)}%`;
      }
    },
  });

  try {
    const result = await worker.recognize(file);
    const orders = parseOrderTotalFromOcr(result.data.text);
    if (orders) {
      els.ordersInput.value = orders;
      updateOrders(orders);
      els.ocrStatus.textContent = `تم استخراج إجمالي الطلبات: ${formatPlainInteger(orders)}. يمكنك تعديل الرقم إذا احتجت.`;
    } else {
      els.ocrStatus.textContent = "لم أتمكن من تحديد إجمالي الطلبات تلقائيًا. أدخل الرقم يدويًا من أعلى الصورة.";
    }
  } finally {
    await worker.terminate();
  }
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
    await analyzePdf({ data: bytes }, file.name);
  } catch (error) {
    console.error(error);
    setStatus("تعذر تحليل الملف. تأكد أن الملف PDF نصي وليس صورة ممسوحة فقط.", "error");
  }
});

els.search.addEventListener("input", () => renderTable(allProducts));

els.ordersInput.addEventListener("input", () => {
  updateOrders(els.ordersInput.value);
});

els.sessionImageInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  els.sessionImagePreview.src = URL.createObjectURL(file);
  els.sessionImagePreview.classList.add("visible");

  try {
    await recognizeSessionImage(file);
  } catch (error) {
    console.error(error);
    els.ocrStatus.textContent = "تعذرت قراءة الصورة تلقائيًا. أدخل إجمالي الطلبات يدويًا من أعلى الصورة.";
  }
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
  try {
    const response = await fetch(encodeURI(defaultPdfName));
    if (!response.ok) throw new Error("Default PDF not found");
    const bytes = await response.arrayBuffer();
    await analyzePdf({ data: bytes }, defaultPdfName);
  } catch (error) {
    console.warn(error);
    setStatus("ارفع ملف PDF للبدء. المتصفح منع تحميل الملف الافتراضي مباشرة.", "ready");
  }
}

boot();
