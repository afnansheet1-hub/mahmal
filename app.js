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

let allProducts = [];

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
    .filter((row) => row.amount > 0)
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

  allProducts = mergeContinuationRows(rows);
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
  renderTable(products);
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
