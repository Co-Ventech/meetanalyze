/**
 * Utility to convert Markdown Meeting Insights into a Microsoft Word compatible (.doc) document.
 * Outputs an HTML-based Word document with Office namespaces, print margins, and executive styling.
 */

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Basic markdown parser to transform headings, tables, lists, and emphasis into semantic HTML.
 */
function markdownToWordHtml(markdown) {
  if (!markdown) return '';

  const lines = markdown.split(/\r?\n/);
  const htmlLines = [];
  let inList = false;
  let listType = '';
  let inTable = false;
  let tableHeaderParsed = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Detect Markdown Table
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      // Check if it's a separator line like |---|---|
      if (/^\|[\s\-:|]+\|$/.test(line.trim())) {
        tableHeaderParsed = true;
        continue;
      }

      if (!inTable) {
        if (inList) {
          htmlLines.push(`</${listType}>`);
          inList = false;
        }
        inTable = true;
        tableHeaderParsed = false;
        htmlLines.push('<table>');
      }

      const cells = line
        .trim()
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());

      const tag = tableHeaderParsed ? 'td' : 'th';
      const rowContent = cells
        .map((cell) => `<${tag}>${formatInline(cell)}</${tag}>`)
        .join('');
      htmlLines.push(`<tr>${rowContent}</tr>`);
      continue;
    } else if (inTable) {
      htmlLines.push('</table>');
      inTable = false;
      tableHeaderParsed = false;
    }

    // Detect Bullet Lists
    const bulletMatch = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bulletMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) htmlLines.push(`</${listType}>`);
        inList = true;
        listType = 'ul';
        htmlLines.push('<ul>');
      }
      htmlLines.push(`<li>${formatInline(bulletMatch[2])}</li>`);
      continue;
    }

    // Detect Numbered Lists
    const numberMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (numberMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) htmlLines.push(`</${listType}>`);
        inList = true;
        listType = 'ol';
        htmlLines.push('<ol>');
      }
      htmlLines.push(`<li>${formatInline(numberMatch[2])}</li>`);
      continue;
    }

    // Close any active list
    if (inList) {
      htmlLines.push(`</${listType}>`);
      inList = false;
    }

    // Headings
    if (/^####\s+(.*)$/.test(line)) {
      htmlLines.push(`<h4>${formatInline(line.replace(/^####\s+/, ''))}</h4>`);
    } else if (/^###\s+(.*)$/.test(line)) {
      htmlLines.push(`<h3>${formatInline(line.replace(/^###\s+/, ''))}</h3>`);
    } else if (/^##\s+(.*)$/.test(line)) {
      htmlLines.push(`<h2>${formatInline(line.replace(/^##\s+/, ''))}</h2>`);
    } else if (/^#\s+(.*)$/.test(line)) {
      htmlLines.push(`<h1>${formatInline(line.replace(/^#\s+/, ''))}</h1>`);
    } else if (/^>\s+(.*)$/.test(line)) {
      // Blockquote
      htmlLines.push(`<blockquote>${formatInline(line.replace(/^>\s+/, ''))}</blockquote>`);
    } else if (line.trim().length > 0) {
      // Regular paragraph
      htmlLines.push(`<p>${formatInline(line)}</p>`);
    }
  }

  if (inList) htmlLines.push(`</${listType}>`);
  if (inTable) htmlLines.push('</table>');

  return htmlLines.join('\n');
}

/**
 * Handle inline markdown: bold, italic, code, quotes
 */
function formatInline(text) {
  if (!text) return '';
  let res = escapeHtml(text);
  // Bold & Italic
  res = res.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
  res = res.replace(/___(.*?)___/g, '<strong><em>$1</em></strong>');
  // Bold
  res = res.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  res = res.replace(/__(.*?)__/g, '<strong>$1</strong>');
  // Italic
  res = res.replace(/\*(.*?)\*/g, '<em>$1</em>');
  res = res.replace(/_(.*?)_/g, '<em>$1</em>');
  // Inline code
  res = res.replace(/`([^`]+)`/g, '<code style="background-color:#f1f5f9;padding:2px 4px;border-radius:3px;font-family:Courier New;">$1</code>');
  return res;
}

/**
 * Generate a complete .doc (Microsoft Word HTML) buffer.
 */
function generateMeetingDoc(analysisMarkdown, metadata = {}) {
  const contentHtml = markdownToWordHtml(analysisMarkdown);
  const nowStr = metadata.generatedAt || new Date().toLocaleString();
  const title = metadata.title || 'Meeting Insight & Sales Performance Report';

  const docHtml = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
      <w:DoNotOptimizeForBrowser/>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    @page Section1 {
      size: 8.5in 11.0in;
      margin: 1.0in 1.0in 1.0in 1.0in;
      mso-header-margin: .5in;
      mso-footer-margin: .5in;
      mso-paper-source: 0;
    }
    div.Section1 {
      page: Section1;
    }
    body {
      font-family: 'Calibri', 'Segoe UI', 'Arial', sans-serif;
      font-size: 11pt;
      line-height: 1.5;
      color: #1e293b;
      background-color: #ffffff;
    }
    h1 {
      color: #1e3a8a;
      font-size: 22pt;
      font-weight: bold;
      margin-top: 0;
      margin-bottom: 8pt;
      border-bottom: 2.5pt solid #2563eb;
      padding-bottom: 6pt;
    }
    h2 {
      color: #1e40af;
      font-size: 14pt;
      font-weight: bold;
      margin-top: 18pt;
      margin-bottom: 6pt;
      border-bottom: 1pt solid #cbd5e1;
      padding-bottom: 3pt;
    }
    h3 {
      color: #334155;
      font-size: 12pt;
      font-weight: bold;
      margin-top: 14pt;
      margin-bottom: 4pt;
    }
    p {
      margin-top: 0;
      margin-bottom: 6pt;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 12pt 0;
      font-size: 10pt;
    }
    th, td {
      border: 1pt solid #cbd5e1;
      padding: 6pt 10pt;
      text-align: left;
      vertical-align: top;
    }
    th {
      background-color: #f1f5f9;
      color: #0f172a;
      font-weight: bold;
    }
    ul, ol {
      margin-top: 0;
      margin-bottom: 8pt;
      padding-left: 20pt;
    }
    li {
      margin-bottom: 3pt;
    }
    blockquote {
      background-color: #f8fafc;
      border-left: 3.5pt solid #3b82f6;
      padding: 6pt 12pt;
      margin: 8pt 0;
      color: #334155;
      font-style: italic;
    }
    .header-box {
      background-color: #f8fafc;
      border: 1pt solid #e2e8f0;
      padding: 10pt 14pt;
      margin-bottom: 18pt;
      border-radius: 4pt;
    }
    .header-box table {
      margin: 0;
      border: none;
    }
    .header-box td {
      border: none;
      padding: 2pt 6pt;
      font-size: 9.5pt;
      color: #64748b;
    }
    .footer-note {
      margin-top: 24pt;
      padding-top: 8pt;
      border-top: 1pt solid #e2e8f0;
      font-size: 9pt;
      color: #94a3b8;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="Section1">
    <h1>${escapeHtml(title)}</h1>

    <div class="header-box">
      <table>
        <tr>
          <td><strong>Generated:</strong> ${escapeHtml(nowStr)}</td>
          <td><strong>Analysis Engine:</strong> MeetAnalyze Sales Intelligence</td>
        </tr>
        <tr>
          <td><strong>Evaluation Type:</strong> Sales Call Performance Assessment</td>
          <td><strong>Format:</strong> Microsoft Word Document (.doc)</td>
        </tr>
      </table>
    </div>

    ${contentHtml}

    <div class="footer-note">
      Confidential — Generated by MeetAnalyze & AssemblyAI Speech Intelligence for Coaching & Performance Review.
    </div>
  </div>
</body>
</html>`;

  return Buffer.from(docHtml, 'utf-8');
}

module.exports = {
  markdownToWordHtml,
  generateMeetingDoc,
};

