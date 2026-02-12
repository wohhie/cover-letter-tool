
import { useEffect, useMemo, useRef, useState } from "react";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { saveAs } from "file-saver";
import { AlignmentType, Document, Packer, Paragraph, TextRun } from "docx";

const LS_KEY = "cover-letter-tool:v2";

// Store date as ISO (yyyy-mm-dd)
function todayISO() {
    return new Date().toISOString().split("T")[0];
}

// ✅ SAFE Canadian long date formatter
function formatToCanadianLong(value) {
    if (!value) return "";

    // If it's already in ISO format yyyy-mm-dd, parse it safely.
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const d = new Date(value + "T00:00:00");
        if (!Number.isNaN(d.getTime())) {
            return new Intl.DateTimeFormat("en-CA", {
                day: "2-digit",
                month: "long",
                year: "numeric",
            }).format(d);
        }
    }

    // Otherwise (old localStorage value like "11 February 2026"), just return as-is.
    return value;
}

// Compress 2+ blank lines to a single blank line
function compressBlankLines(s) {
    if (!s) return "";
    const normalized = s.replace(/\r\n/g, "\n");
    return normalized.replace(/\n[ \t]*\n([ \t]*\n)+/g, "\n\n");
}

function slugifyFilePart(s) {
    return (s || "")
        .trim()
        .replace(/[\s/\\]+/g, "_")
        .replace(/[^a-zA-Z0-9_-]+/g, "")
        .replace(/_+/g, "_")
        .slice(0, 40);
}

function applyTemplate(template, values) {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
        const v = values[key];
        return (v ?? "").toString();
    });
}

function safeLoad() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

function safeSave(obj) {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(obj));
    } catch {
        // ignore
    }
}

// ✅ Keep your template TEXT EXACTLY the same
const DEFAULT_TEMPLATE = `Nazmush Shakib Mahmud
Administrative and Organizational Management Professional
Email: shakibmahmud9531@gmail.com
Phone: +8801926082900
LinkedIn: https://www.linkedin.com/in/nazmush-shakib-mahmud-4383822ab

{{date}}
{{employerName}}
{{companyAddressLine1}}
{{companyAddressLine2}}

Dear Hiring Manager,

I am writing to express my interest in the {{position}} position in your organization with my 16 years of experience across corporate and military environments. I have a solid background in administration, executive support, organizational governance, and project coordination, supported by a proven track record of improving efficiency and controlling costs.

Presently, I am working as Assistant General Manager at itcroc where I supervise comprehensive administrative operations, documentation, procurement management, and project monitoring. Reduction of project cost and improved management visibility are enhanced through an efficient and structured administrative delivery and monitoring system. Previously, I provided senior-level executive and secretariat support to the vice chairman of Bashundhara Group. Standardized communication was established amongst internal and external stakeholders of the group that reduced operational costs. I implemented a structured administrative and tracking mechanism that assisted senior management during my tenure.

Earlier, I served in administrative and organizational management roles in the Bangladesh Air Force, where I led small and large teams, coordinated resources, developed SOPs, managed, and reviewed personnel. Moreover, I was involved in humanitarian operations at a national and international level in a high-risk environment. All these required proficient discretion and the ability to manage competing priorities, which strengthened my ability to operate effectively for the last 16 years.

I am open to move to Canada and would like to contribute my experience and skills to your organization. Thank you for your consideration.




Sincerely,
Nazmush Shakib Mahmud
`;

function Field({
                   label,
                   value,
                   onChange,
                   placeholder,
                   type = "text",
                   required = false,
               }) {
    return (
        <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
                {label} {required && <span className="text-red-600">*</span>}
            </label>
            <input
                type={type}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-300"
                value={value}
                onChange={onChange}
                placeholder={placeholder}
            />
        </div>
    );
}

// ===== Helpers for justified preview + LinkedIn link =====
function splitIntoParagraphs(text) {
    return (text || "").replace(/\r\n/g, "\n").split(/\n\s*\n/g);
}

function linkifyLinkedInInline(text) {
    const re = /(https?:\/\/(?:www\.)?linkedin\.com\/[^\s]+)/gi;
    const parts = (text || "").split(re);

    return parts.map((part, i) => {
        if (re.test(part)) {
            return (
                <a
                    key={i}
                    href={part}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 underline"
                >
                    {part}
                </a>
            );
        }
        return <span key={i}>{part}</span>;
    });
}

export default function App() {
    const [fields, setFields] = useState(() => {
        const saved = safeLoad();

        // ✅ Ensure date stored for input type="date" is valid ISO
        const savedDate = saved?.date;
        const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(savedDate || "")
            ? savedDate
            : todayISO();

        return {
            date: safeDate,

            // ✅ Single merged required field (employer/company)
            employerCompanyName:
                saved?.employerCompanyName ||
                saved?.companyName ||
                saved?.employerName ||
                "",

            companyAddressLine1: saved?.companyAddressLine1 || "",
            companyAddressLine2: saved?.companyAddressLine2 || "",

            // ✅ required
            position: saved?.position || "",

            // template stays
            template: saved?.template || DEFAULT_TEMPLATE,
        };
    });

    const previewRef = useRef(null);
    const [isOverflow, setIsOverflow] = useState(false);

    // ✅ Template edit lock (disabled by default)
    const [templateEditable, setTemplateEditable] = useState(false);

    // Toast (non-blocking)
    const [toast, setToast] = useState({ open: false, message: "" });
    const showToast = (message) => {
        setToast({ open: true, message });
        window.clearTimeout(showToast._t);
        showToast._t = window.setTimeout(() => {
            setToast({ open: false, message: "" });
        }, 1800);
    };

    // ✅ Mandatory validation
    const requiredErrors = useMemo(() => {
        const errs = {};
        if (!fields.employerCompanyName?.trim())
            errs.employerCompanyName = "Employer/Company Name is required";
        if (!fields.position?.trim()) errs.position = "Position is required";
        return errs;
    }, [fields.employerCompanyName, fields.position]);

    const isFormValid = Object.keys(requiredErrors).length === 0;

    // Persist
    useEffect(() => {
        safeSave(fields);
    }, [fields]);

    const rendered = useMemo(() => {
        const { template, ...vals } = fields;

        const employerCompany = (vals.employerCompanyName || "").trim();

        const normalized = {
            ...vals,
            employerName: employerCompany,
            companyName: employerCompany,
            companyAddressLine2: vals.companyAddressLine2 || "",
            date: formatToCanadianLong(vals.date),
        };

        const filled = applyTemplate(template, normalized);
        return compressBlankLines(filled);
    }, [fields]);

    // Overflow detection for A4 preview
    useEffect(() => {
        const el = previewRef.current;
        if (!el) return;

        const check = () => setIsOverflow(el.scrollHeight > el.clientHeight + 1);

        check();
        const ro = new ResizeObserver(check);
        ro.observe(el);
        return () => ro.disconnect();
    }, [rendered]);

    const onChange = (key) => (e) =>
        setFields((prev) => ({ ...prev, [key]: e.target.value }));

    const resetAll = () => {
        localStorage.removeItem(LS_KEY);
        setFields({
            date: todayISO(),
            employerCompanyName: "",
            companyAddressLine1: "",
            companyAddressLine2: "",
            position: "",
            template: DEFAULT_TEMPLATE,
        });
        setTemplateEditable(false);
    };

    const copyToClipboard = async () => {
        if (!isFormValid) {
            showToast("Fill required fields first");
            return;
        }

        try {
            await navigator.clipboard.writeText(rendered);
            showToast("Copied to clipboard");
        } catch {
            const ta = document.createElement("textarea");
            ta.value = rendered;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            showToast("Copied to clipboard");
        }
    };

    const downloadPdf = async () => {
        if (!isFormValid) {
            showToast("Fill required fields first");
            return;
        }

        if (isOverflow) {
            const ok = window.confirm(
                "This cover letter appears to exceed one page. The PDF will be cut off at the bottom. Download anyway?"
            );
            if (!ok) return;
        }

        // A4 in points
        const PAGE_W = 595.28;
        const PAGE_H = 841.89;

        const MARGIN = 72; // 1 inch
        const FONT_SIZE = 11;
        const LINE_HEIGHT = 14.5;

        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        const maxWidth = PAGE_W - MARGIN * 2;
        let y = PAGE_H - MARGIN;

        const text = rendered;
        const paragraphs = text.split("\n");

        const wrapLine = (line) => {
            if (!line.trim()) return [""];

            const words = line.split(/\s+/);
            const lines = [];
            let current = "";

            for (const word of words) {
                const candidate = current ? `${current} ${word}` : word;
                const width = font.widthOfTextAtSize(candidate, FONT_SIZE);

                if (width <= maxWidth) {
                    current = candidate;
                } else {
                    if (current) lines.push(current);

                    if (font.widthOfTextAtSize(word, FONT_SIZE) > maxWidth) {
                        let chunk = "";
                        for (const ch of word) {
                            const cand2 = chunk + ch;
                            if (font.widthOfTextAtSize(cand2, FONT_SIZE) <= maxWidth) {
                                chunk = cand2;
                            } else {
                                lines.push(chunk);
                                chunk = ch;
                            }
                        }
                        current = chunk;
                    } else {
                        current = word;
                    }
                }
            }

            if (current) lines.push(current);
            return lines;
        };

        for (const p of paragraphs) {
            const wrapped = wrapLine(p);

            for (const line of wrapped) {
                y -= LINE_HEIGHT;
                if (y < MARGIN) break;
                page.drawText(line, { x: MARGIN, y, size: FONT_SIZE, font });
            }

            if (y < MARGIN) break;
        }

        const bytes = await pdfDoc.save();
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;

        const company = slugifyFilePart(fields.employerCompanyName) || "Company";
        const position = slugifyFilePart(fields.position) || "Position";
        a.download = `CoverLetter_${company}_${position}.pdf`;

        a.click();
        URL.revokeObjectURL(url);
    };

    // ✅ DOCX download (justified body paragraphs)
    const downloadDocx = async () => {
        if (!isFormValid) {
            showToast("Fill required fields first");
            return;
        }

        const company = slugifyFilePart(fields.employerCompanyName) || "Company";
        const position = slugifyFilePart(fields.position) || "Position";

        const docParagraphs = splitIntoParagraphs(rendered).map((para) => {
            const text = para || "";
            const compact = text.replace(/\s+/g, " ").trim();
            const isLong = compact.length > 120;

            const lines = text.split("\n");
            const runs = [];

            lines.forEach((ln, idx) => {
                runs.push(new TextRun(ln));
                if (idx < lines.length - 1) runs.push(new TextRun({ break: 1 }));
            });

            return new Paragraph({
                children: runs,
                alignment: isLong ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
                spacing: { after: 200 },
            });
        });

        const doc = new Document({
            sections: [
                {
                    properties: {},
                    children: docParagraphs,
                },
            ],
        });

        const blob = await Packer.toBlob(doc);
        saveAs(blob, `CoverLetter_${company}_${position}.docx`);
    };

    const previewParagraphs = useMemo(() => splitIntoParagraphs(rendered), [rendered]);

    return (
        <div className="min-h-screen bg-gray-100">
            <div className="mx-auto max-w-[1500px] p-4">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {/* Left: Inputs + Template */}
                    <div className="rounded-2xl bg-white p-4 shadow">
                        <div className="flex items-center justify-between">
                            <h1 className="text-xl font-semibold">
                                Cover Letter Template Tool
                            </h1>
                            <button
                                onClick={resetAll}
                                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                            >
                                Reset
                            </button>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-3">
                            <Field
                                label="Date"
                                value={fields.date}
                                onChange={onChange("date")}
                                type="date"
                            />

                            <Field
                                label="Employer / Company Name"
                                value={fields.employerCompanyName}
                                onChange={onChange("employerCompanyName")}
                                placeholder="e.g., ABC Corp"
                                required
                            />
                            {requiredErrors.employerCompanyName && (
                                <div className="-mt-2 text-xs font-medium text-red-600">
                                    {requiredErrors.employerCompanyName}
                                </div>
                            )}

                            <Field
                                label="Company Address Line 1"
                                value={fields.companyAddressLine1}
                                onChange={onChange("companyAddressLine1")}
                                placeholder="Street, City"
                            />
                            <Field
                                label="Company Address Line 2"
                                value={fields.companyAddressLine2}
                                onChange={onChange("companyAddressLine2")}
                                placeholder="Province, Postal Code"
                            />

                            <Field
                                label="Position"
                                value={fields.position}
                                onChange={onChange("position")}
                                placeholder="Administrative Assistant"
                                required
                            />
                            {requiredErrors.position && (
                                <div className="-mt-2 text-xs font-medium text-red-600">
                                    {requiredErrors.position}
                                </div>
                            )}
                        </div>

                        <div className="mt-4">
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <label className="block text-sm font-medium text-gray-700">
                                    Template
                                </label>

                                <button
                                    type="button"
                                    onClick={() => setTemplateEditable((v) => !v)}
                                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                                >
                                    {templateEditable ? "Lock Template" : "Enable Editing"}
                                </button>
                            </div>

                            <textarea
                                className="h-[420px] w-full rounded-xl border border-gray-300 p-3 font-mono text-sm leading-5 outline-none focus:ring-2 focus:ring-gray-300 disabled:bg-gray-50"
                                value={fields.template}
                                onChange={onChange("template")}
                                spellCheck={false}
                                disabled={!templateEditable}
                            />

                            <p className="mt-2 text-xs text-gray-500">
                                Placeholders: <span className="font-mono">{`{{date}}`}</span>,{" "}
                                <span className="font-mono">{`{{employerName}}`}</span>,{" "}
                                <span className="font-mono">{`{{companyName}}`}</span>,{" "}
                                <span className="font-mono">{`{{companyAddressLine1}}`}</span>,{" "}
                                <span className="font-mono">{`{{companyAddressLine2}}`}</span>,{" "}
                                <span className="font-mono">{`{{position}}`}</span>.
                                <span className="ml-2">
                  (Employer & Company auto-filled from the same field.)
                </span>
                            </p>
                        </div>
                    </div>

                    {/* Right: Preview */}
                    <div className="rounded-2xl bg-white p-4 shadow">
                        <div className="flex items-center justify-between gap-3">
                            <h2 className="text-lg font-semibold">Live Preview (A4)</h2>

                            <div className="flex flex-wrap items-center gap-2">
                                {isOverflow ? (
                                    <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                    ⚠ Exceeds one page — shorten text
                  </span>
                                ) : (
                                    <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                    Fits on one page
                  </span>
                                )}

                                <button
                                    onClick={copyToClipboard}
                                    disabled={!isFormValid}
                                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    title={!isFormValid ? "Fill required fields first" : "Copy"}
                                >
                                    Copy Text
                                </button>

                                <button
                                    onClick={downloadDocx}
                                    disabled={!isFormValid}
                                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    title={!isFormValid ? "Fill required fields first" : "Download DOCX"}
                                >
                                    Download DOCX
                                </button>

                                <button
                                    onClick={downloadPdf}
                                    disabled={!isFormValid}
                                    className="rounded-lg bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                                    title={!isFormValid ? "Fill required fields first" : "Download PDF"}
                                >
                                    Download PDF
                                </button>
                            </div>
                        </div>

                        <div className="mt-4 flex justify-center bg-gray-100 p-4">
                            {/* A4 sheet look (pixels for preview) */}
                            <div className="h-[1123px] w-[794px] rounded-sm bg-white shadow-xl">
                                <div
                                    ref={previewRef}
                                    className="h-full w-full overflow-hidden p-16 text-[14px] leading-6 text-gray-900"
                                    style={{
                                        whiteSpace: "normal",
                                        fontFamily: "Helvetica, Arial, sans-serif",
                                    }}
                                >
                                    {previewParagraphs.map((para, idx) => {
                                        const compact = para.replace(/\s+/g, " ").trim();
                                        const shouldJustify = compact.length > 120; // justify body paragraphs
                                        const lines = para.split("\n");

                                        return (
                                            <p
                                                key={idx}
                                                style={{
                                                    margin: "0 0 12px 0",
                                                    textAlign: shouldJustify ? "justify" : "left",
                                                }}
                                            >
                                                {lines.map((line, li) => (
                                                    <span key={li}>
                            {linkifyLinkedInInline(line)}
                                                        {li < lines.length - 1 ? <br /> : null}
                          </span>
                                                ))}
                                            </p>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <p className="mt-3 text-xs text-gray-500">
                            Note: PDF is generated in A4 points. Preview is a close visual
                            approximation.
                        </p>
                    </div>
                </div>
            </div>

            {/* Toast */}
            {toast.open && (
                <div className="fixed right-4 top-4 z-50 rounded-xl bg-black px-4 py-2 text-sm text-white shadow-lg">
                    {toast.message}
                </div>
            )}
        </div>
    );
}
