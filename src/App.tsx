import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ExternalLink,
  Loader2,
  MessageSquareText,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import type {
  AppSettings,
  Conversation,
  ConversationEnvironment,
  ConversationMessage,
  Correction,
  LookupResult,
  StudyItem,
  StudyItemSource,
  StudyItemType,
} from "./shared";
import { extractRelatedPhrases } from "./phrase-utils";

type TabKey = "chat" | "library" | "lookup" | "settings";

type AnchorPoint = {
  x: number;
  y: number;
};

type HoverLookupState = {
  result: LookupResult;
  anchor: AnchorPoint;
  relatedPhrases: string[];
  context: string;
};

type StudyDraft = {
  id?: string;
  type: StudyItemType;
  english: string;
  chineseMeaning: string;
  source: StudyItemSource;
  tags: string;
  note: string;
  lookup?: LookupResult;
};

const initialDraft: StudyDraft = {
  type: "word",
  english: "",
  chineseMeaning: "",
  source: "manual",
  tags: "",
  note: "",
};

function hasCjk(text: string) {
  return /[\u3400-\u4dbf\u4e00-\u9fff]/.test(text);
}

function isLikelyPhrase(text: string) {
  return /\s/.test(text.trim()) || text.trim().length > 14;
}

function isLikelySentence(text: string) {
  const compact = text.trim();
  const wordCount = compact.split(/\s+/).filter(Boolean).length;
  if (wordCount < 2) return false;
  if (/[.!?]$/.test(compact) || /[,;:]/.test(compact)) return true;
  return /^(i|you|we|they|he|she|it|there|this|that|these|those)\b/i.test(compact);
}

function normalizeToken(token: string) {
  return token
    .trim()
    .replace(/^[^\p{L}\p{N}\u4e00-\u9fff']+|[^\p{L}\p{N}\u4e00-\u9fff']+$/gu, "")
    .trim();
}

function toLookupType(query: string): StudyItemType {
  if (isLikelySentence(query)) return "sentence";
  return isLikelyPhrase(query) ? "phrase" : "word";
}

function textPreview(text: string, limit = 96) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit)}...` : compact;
}

function lookupChineseMeaning(result: LookupResult) {
  return (
    result.translation ||
    result.senses.map((sense) => sense.meaning).filter(Boolean).join("; ") ||
    result.examples.find((example) => example.chinese)?.chinese ||
    ""
  );
}

function mergeLookupResults(base: LookupResult, supplement: LookupResult): LookupResult {
  const senses = Array.from(
    new Map(
      [...base.senses, ...supplement.senses].map((sense) => [
        `${sense.partOfSpeech || ""}:${sense.meaning}:${sense.englishDefinition || ""}`,
        sense,
      ]),
    ).values(),
  );
  const examples = Array.from(
    new Map(
      [...base.examples, ...supplement.examples].map((example) => [
        `${example.english}:${example.chinese || ""}`,
        example,
      ]),
    ).values(),
  );
  const list = (values: string[]) => Array.from(new Set(values.filter((value) => value.trim())));
  return {
    ...base,
    ...supplement,
    headword: supplement.headword || base.headword,
    pronunciation: supplement.pronunciation || base.pronunciation,
    translation: supplement.translation || base.translation,
    senses,
    collocations: list([...base.collocations, ...supplement.collocations]),
    examples,
    synonyms: list([...(base.synonyms || []), ...(supplement.synonyms || [])]),
    alternatives: list([...(base.alternatives || []), ...(supplement.alternatives || [])]),
    wordForms: list([...(base.wordForms || []), ...(supplement.wordForms || [])]),
    sourceUrl: supplement.sourceUrl || base.sourceUrl,
    found: base.found || supplement.found,
  };
}

function deriveStudyDraftFromLookup(result: LookupResult): StudyDraft {
  const type = toLookupType(result.query);
  const english = result.direction === "zh-en" ? result.senses[0]?.meaning || result.query : result.headword || result.query;
  const chineseMeaning =
    result.direction === "zh-en"
      ? result.query
      : lookupChineseMeaning(result);
  return {
    type,
    english,
    chineseMeaning,
    source: result.source,
    tags:
      result.source === "local-dictionary"
        ? "本地词典"
        : result.source === "ai"
          ? "AI"
          : result.source === "collins"
            ? "柯林斯"
            : "本地应急",
    note: "",
    lookup: result,
  };
}

function deriveStudyDraftFromItem(item: StudyItem): StudyDraft {
  return {
    id: item.id,
    type: item.type,
    english: item.english,
    chineseMeaning: item.chineseMeaning || "",
    source: item.source,
    tags: "",
    note: "",
    lookup: item.lookup,
  };
}

function buildCorrectionText(correction: Correction) {
  const rows = [correction.original, correction.recommended, correction.reason, ...(correction.details ?? []), ...(correction.alternatives ?? [])];
  return rows.filter(Boolean).join(" ");
}

function sourceLabel(source: LookupResult["source"]) {
  if (source === "local-dictionary") return "本地词典";
  if (source === "ai") return "AI 查询";
  if (source === "collins") return "柯林斯";
  return "本地应急词库";
}

const conversationEnvironmentOptions: Array<{
  value: ConversationEnvironment;
  label: string;
  description: string;
}> = [
  { value: "casual", label: "轻松日常", description: "自然口语、友好随意" },
  { value: "serious", label: "严肃正式", description: "准确、尊重、避免俚语" },
  { value: "work", label: "职场沟通", description: "清晰、得体、专业" },
  { value: "academic", label: "学术表达", description: "严谨、结构化、少口语化" },
  { value: "travel", label: "旅行场景", description: "实用、礼貌、易懂" },
];

function lookupStatusLabel(result: LookupResult) {
  if (!result.found) return result.message || "未找到对应词条";
  return result.source === "local-dictionary" ? "本地词典 · 即时结果" : `${sourceLabel(result.source)} · 已返回`;
}

function tokenize(text: string) {
  return text.split(/(\s+)/);
}

function ExpressionChip(props: { text: string; onClick: (text: string) => void }) {
  const { text, onClick } = props;
  return (
    <button
      className="chip chip-button"
      type="button"
      title={`查看“${text}”的详情`}
      onClick={() => onClick(text)}
    >
      {text}
    </button>
  );
}

function clampAnchor(x: number, y: number): AnchorPoint {
  return {
    x: Math.max(12, Math.min(x, window.innerWidth - 392)),
    y: Math.max(12, Math.min(y, window.innerHeight - 300)),
  };
}

function QuickLookupPopover(props: {
  result: LookupResult;
  anchor: AnchorPoint;
  relatedPhrases: string[];
  collocations: string[];
  onDetails: () => void;
  onAdd: () => void;
  onPhraseLookup: (phrase: string) => void;
  onClose: () => void;
}) {
  const {
    result,
    anchor,
    relatedPhrases,
    collocations,
    onDetails,
    onAdd,
    onPhraseLookup,
    onClose,
  } = props;
  return (
    <div
      className="lookup-popover"
      style={{ left: anchor.x, top: anchor.y }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="lookup-popover-header">
        <div>
          <div className="lookup-popover-headword">{result.headword || result.query}</div>
          <div className="lookup-popover-meta">{result.pronunciation || sourceLabel(result.source)}</div>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
          <X size={16} />
        </button>
      </div>
      <div className="lookup-popover-body">
        {result.found ? (
          <>
            <div className={result.translation ? "lookup-popover-translation" : "lookup-popover-meaning"}>
              {result.translation || result.senses[0]?.meaning || "暂无释义"}
            </div>
            {result.translation ? <div className="lookup-popover-example">中文翻译</div> : null}
            {!result.translation && result.examples[0]?.english ? (
              <div className="lookup-popover-example">{result.examples[0].english}</div>
            ) : null}
          </>
        ) : (
          <div className="lookup-popover-meaning muted">{result.message || "未找到对应词条"}</div>
        )}
      </div>
      {relatedPhrases.length ? (
        <div className="lookup-popover-related">
          <div className="section-label">句中相关短语</div>
          <div className="chip-row">
            {relatedPhrases.map((phrase) => (
              <ExpressionChip key={phrase} text={phrase} onClick={onPhraseLookup} />
            ))}
          </div>
        </div>
      ) : null}
      {collocations.length ? (
        <div className="lookup-popover-related">
          <div className="section-label">常见搭配</div>
          <div className="chip-row">
            {collocations.map((collocation) => (
              <ExpressionChip key={collocation} text={collocation} onClick={onPhraseLookup} />
            ))}
          </div>
        </div>
      ) : null}
      <div className="lookup-popover-actions">
        <button className="ghost-button" type="button" onClick={onAdd} disabled={!result.found}>
          收藏
        </button>
        <button className="primary-button" type="button" onClick={onDetails} disabled={!result.found}>
          详情
        </button>
      </div>
    </div>
  );
}

function DetailModal(props: {
  result: LookupResult;
  onClose: () => void;
  onBack?: () => void;
  onAdd: () => void;
  onPhraseLookup: (phrase: string) => void;
  onEnrich: () => void;
  enriching: boolean;
}) {
  const { result, onClose, onBack, onAdd, onPhraseLookup, onEnrich, enriching } = props;
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-panel modal-panel-wide">
        <div className="modal-header">
          <div>
            <div className="modal-title">{result.headword || result.query}</div>
            <div className="modal-subtitle">
              {result.pronunciation ? `${result.pronunciation} · ` : ""}
              {result.direction === "en-zh" ? "英译中" : "中译英"}
            </div>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="detail-grid">
          {result.translation ? (
            <section className="detail-section detail-section-wide">
              <h3>中文翻译</h3>
              <div className="study-detail-translation">{result.translation}</div>
            </section>
          ) : null}
          {result.senses.length ? (
            <section className="detail-section">
              <h3>释义</h3>
              <div className="sense-list">
                {result.senses.map((sense, index) => (
                  <div className="sense-row" key={`${sense.meaning}-${index}`}>
                    <div className="sense-pos">{sense.partOfSpeech || "词性"}</div>
                    <div>
                      <div className="sense-meaning">{sense.meaning}</div>
                      {sense.englishDefinition ? <div className="sense-def">{sense.englishDefinition}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : !result.translation && !result.found ? (
            <section className="detail-section">
              <h3>释义</h3>
              <div className="muted">{result.message || "未找到对应词条"}</div>
            </section>
          ) : null}
          <section className="detail-section">
            <h3>例句</h3>
            <div className="example-list">
              {result.examples.length ? (
                result.examples.map((example, index) => (
                  <div className="example-row" key={`${example.english}-${index}`}>
                    <div className="example-en">{example.english}</div>
                    {example.chinese ? <div className="example-zh">{example.chinese}</div> : null}
                  </div>
                ))
              ) : (
                <div className="muted">-</div>
              )}
            </div>
          </section>
          <section className="detail-section">
            <h3>搭配</h3>
            <div className="chip-row">
              {result.collocations.length ? (
                result.collocations.map((item) => (
                  <ExpressionChip key={item} text={item} onClick={onPhraseLookup} />
                ))
              ) : (
                <span className="muted">-</span>
              )}
            </div>
          </section>
          {result.synonyms?.length ? (
            <section className="detail-section">
              <h3>近义表达</h3>
              <div className="chip-row">
                {result.synonyms.map((item) => (
                  <ExpressionChip key={item} text={item} onClick={onPhraseLookup} />
                ))}
              </div>
            </section>
          ) : null}
          {result.alternatives?.length ? (
            <section className="detail-section">
              <h3>自然表达</h3>
              <div className="chip-row">
                {result.alternatives.map((item) => (
                  <ExpressionChip key={item} text={item} onClick={onPhraseLookup} />
                ))}
              </div>
            </section>
          ) : null}
          {result.wordForms?.length ? (
            <section className="detail-section">
              <h3>词形</h3>
              <div className="chip-row">
                {result.wordForms.map((item) => (
                  <ExpressionChip key={item} text={item} onClick={onPhraseLookup} />
                ))}
              </div>
            </section>
          ) : null}
          <section className="detail-section">
            <h3>来源</h3>
            {result.sourceUrl ? (
              <a className="source-link" href={result.sourceUrl} target="_blank" rel="noreferrer">
                {sourceLabel(result.source)} <ExternalLink size={14} />
              </a>
            ) : (
              <span className="muted">{sourceLabel(result.source)}</span>
            )}
          </section>
        </div>
        <div className="modal-footer">
          {onBack ? (
            <button className="ghost-button" type="button" onClick={onBack}>
              <ArrowLeft size={14} />
              返回上一级
            </button>
          ) : null}
          {result.found && result.source !== "ai" ? (
            <button className="ghost-button" type="button" onClick={onEnrich} disabled={enriching}>
              {enriching ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
              AI 补充用法
            </button>
          ) : null}
          <button className="ghost-button" type="button" onClick={onAdd} disabled={!result.found}>
            收藏到单词本
          </button>
          <button className="primary-button" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

function StudyDetailModal(props: {
  item: StudyItem;
  onClose: () => void;
  onEdit: () => void;
  translating: boolean;
  translationMessage: string;
}) {
  const { item, onClose, onEdit, translating, translationMessage } = props;
  const lookup = item.lookup;
  const chineseMeaning = item.chineseMeaning || lookup?.translation || lookup?.senses[0]?.meaning || "暂未添加中文释义";
  const typeLabel = item.type === "word" ? "单词" : item.type === "phrase" ? "短语" : "句子";

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-panel modal-panel-wide study-detail-modal">
        <div className="modal-header">
          <div>
            <div className="modal-title">{item.english}</div>
            <div className="modal-subtitle">
              {lookup?.pronunciation ? `${lookup.pronunciation} · ` : ""}
              {typeLabel}
            </div>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="detail-grid">
          <section className="detail-section detail-section-wide">
            <h3>{item.type === "sentence" ? "中文翻译" : "中文释义"}</h3>
            <div className="study-detail-translation">
              {translating ? (
                <span className="translation-loading">
                  <Loader2 size={15} className="spin" />
                  正在翻译...
                </span>
              ) : chineseMeaning}
            </div>
            {translationMessage ? <div className="study-translation-message">{translationMessage}</div> : null}
          </section>
          {item.type !== "sentence" && lookup?.senses.length ? (
            <section className="detail-section">
              <h3>完整释义</h3>
              <div className="sense-list">
                {lookup.senses.map((sense, index) => (
                  <div className="sense-row" key={`${sense.meaning}-${index}`}>
                    <div className="sense-pos">{sense.partOfSpeech || "词性"}</div>
                    <div>
                      <div className="sense-meaning">{sense.meaning}</div>
                      {sense.englishDefinition ? <div className="sense-def">{sense.englishDefinition}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {lookup?.examples.length ? (
            <section className="detail-section">
              <h3>例句</h3>
              <div className="example-list">
                {lookup.examples.map((example, index) => (
                  <div className="example-row" key={`${example.english}-${index}`}>
                    <div className="example-en">{example.english}</div>
                    {example.chinese ? <div className="example-zh">{example.chinese}</div> : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {lookup?.collocations.length ? (
            <section className="detail-section">
              <h3>常见搭配</h3>
              <div className="chip-row">
                {lookup.collocations.map((item) => <span className="chip" key={item}>{item}</span>)}
              </div>
            </section>
          ) : null}
          {lookup?.synonyms?.length ? (
            <section className="detail-section">
              <h3>近义表达</h3>
              <div className="chip-row">
                {lookup.synonyms.map((item) => <span className="chip" key={item}>{item}</span>)}
              </div>
            </section>
          ) : null}
          {lookup?.alternatives?.length ? (
            <section className="detail-section">
              <h3>自然表达</h3>
              <div className="chip-row">
                {lookup.alternatives.map((item) => <span className="chip" key={item}>{item}</span>)}
              </div>
            </section>
          ) : null}
          {lookup?.wordForms?.length ? (
            <section className="detail-section">
              <h3>词形变化</h3>
              <div className="chip-row">
                {lookup.wordForms.map((item) => <span className="chip" key={item}>{item}</span>)}
              </div>
            </section>
          ) : null}
        </div>
        <div className="modal-footer">
          <button className="ghost-button" type="button" onClick={onEdit}>
            <Settings2 size={14} />
            编辑
          </button>
          <button className="primary-button" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

function StudyEditorModal(props: {
  open: boolean;
  initial: StudyDraft;
  mode: "create" | "edit";
  onClose: () => void;
  onSave: (draft: StudyDraft) => Promise<void>;
  onAutoLookup: (english: string) => Promise<LookupResult>;
  onEnrichLookup: (base: LookupResult, english: string) => Promise<LookupResult | null>;
}) {
  const { open, initial, mode, onClose, onSave, onAutoLookup, onEnrichLookup } = props;
  const [draft, setDraft] = useState<StudyDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupMessage, setLookupMessage] = useState("");
  const lookupRequestRef = useRef(0);
  const lookupActiveRef = useRef(false);

  useEffect(() => {
    setDraft(initial);
    setLookupMessage(initial.lookup ? "已载入学习内容" : "");
  }, [initial, open]);

  const runAutoLookup = async (value = draft.english) => {
    const english = value.trim();
    if (!english) return;
    const requestId = ++lookupRequestRef.current;
    lookupActiveRef.current = true;
    setLookingUp(true);
    setLookupMessage("正在查询翻译...");
    try {
      const result = await onAutoLookup(english);
      if (requestId !== lookupRequestRef.current) return;
      if (!result.found) {
        setLookupMessage(result.message || "暂时没有找到可用内容");
        return;
      }
      setDraft((current) => {
        const type =
          current.type === "sentence" || isLikelySentence(english)
            ? "sentence"
            : toLookupType(english);
        const chineseMeaning =
          type === "sentence"
            ? lookupChineseMeaning(result)
            : lookupChineseMeaning(result);
        return {
          ...current,
          type,
          chineseMeaning,
          source: result.source,
          tags: "",
          note: "",
          lookup: result,
        };
      });
      setLookupMessage(
        result.translation
          ? "已生成中文翻译，可直接保存"
          : result.source === "ai"
            ? "已生成完整学习内容，可修改后保存"
            : "已填入本地释义，正在后台补充例句和搭配...",
      );
      if (result.source === "local-dictionary") {
        void onEnrichLookup(result, english).then((enriched) => {
          if (!enriched || requestId !== lookupRequestRef.current) return;
          setDraft((current) => ({
            ...current,
            source: enriched.source,
            lookup: enriched,
            chineseMeaning: current.type === "sentence" ? lookupChineseMeaning(enriched) : current.chineseMeaning,
          }));
          setLookupMessage("例句、搭配和近义表达已补充完成");
        }).catch(() => {
          if (requestId === lookupRequestRef.current) {
            setLookupMessage("本地释义已填入，AI 补充暂时不可用，可稍后点击自动生成重试");
          }
        });
      }
    } catch (error) {
      if (requestId === lookupRequestRef.current) {
        setLookupMessage(`自动生成失败：${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      if (requestId === lookupRequestRef.current) {
        setLookingUp(false);
      }
      lookupActiveRef.current = false;
    }
  };

  useEffect(() => {
    if (!open) return;
    const english = draft.english.trim();
    if (!english || draft.lookup || (mode === "edit" && draft.chineseMeaning.trim())) return;
    const timer = window.setTimeout(() => {
      if (!lookupActiveRef.current) void runAutoLookup(english);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [draft.english, draft.lookup, draft.type, mode, open]);

  if (!open) return null;

  const submit = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-panel">
        <div className="modal-header">
          <div>
            <div className="modal-title">{mode === "create" ? "新增条目" : "编辑条目"}</div>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>类型</span>
            <select
              value={draft.type}
              onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value as StudyItemType }))}
            >
              <option value="word">单词</option>
              <option value="phrase">短语</option>
              <option value="sentence">例句</option>
            </select>
          </label>
          <label className="field field-span">
            <span>英文</span>
            <div className="field-with-action">
              <input
                value={draft.english}
                onChange={(event) => {
                  const english = event.target.value;
                  lookupRequestRef.current += 1;
                  setLookingUp(false);
                  setLookupMessage("");
                  setDraft((current) => ({ ...current, english, lookup: undefined }));
                }}
                placeholder="输入英文单词、短语或句子"
              />
              <button
                className="ghost-button"
                type="button"
                onClick={() => void runAutoLookup()}
                disabled={lookingUp || !draft.english.trim()}
              >
                {lookingUp ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                自动生成
              </button>
            </div>
          </label>
          <label className="field field-span">
            <span>{draft.type === "sentence" ? "中文翻译" : "中文释义"}</span>
            <input
              value={draft.chineseMeaning}
              onChange={(event) => setDraft((current) => ({ ...current, chineseMeaning: event.target.value }))}
            />
          </label>
        </div>
        {lookupMessage ? <div className={`study-lookup-status ${draft.lookup ? "success" : ""}`}>{lookupMessage}</div> : null}
        {draft.lookup ? (
          <div className="study-auto-fill">
            <div className="study-auto-fill-header">
              <strong>学习内容预览</strong>
            </div>
            {draft.lookup.translation ? (
              <div className="study-auto-fill-section">
                <div className="section-label">中文翻译</div>
                <div className="study-detail-translation">{draft.lookup.translation}</div>
              </div>
            ) : null}
            {draft.lookup.senses.length ? (
              <div className="study-auto-fill-section">
                <div className="section-label">完整释义</div>
                <div className="study-auto-fill-list">
                  {draft.lookup.senses.map((sense, index) => (
                    <div key={`${sense.meaning}-${index}`}>
                      <strong>{sense.partOfSpeech || "词性"}</strong>
                      <span>{sense.meaning}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {draft.lookup.examples.length ? (
              <div className="study-auto-fill-section">
                <div className="section-label">例句</div>
                <div className="example-list">
                  {draft.lookup.examples.map((example, index) => (
                    <div className="example-row" key={`${example.english}-${index}`}>
                      <div className="example-en">{example.english}</div>
                      {example.chinese ? <div className="example-zh">{example.chinese}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {draft.lookup.collocations.length ? (
              <div className="study-auto-fill-section">
                <div className="section-label">常见搭配</div>
                <div className="chip-row">
                  {draft.lookup.collocations.map((item) => <span className="chip" key={item}>{item}</span>)}
                </div>
              </div>
            ) : null}
            {draft.lookup.synonyms?.length ? (
              <div className="study-auto-fill-section">
                <div className="section-label">近义表达</div>
                <div className="chip-row">
                  {draft.lookup.synonyms.map((item) => <span className="chip" key={item}>{item}</span>)}
                </div>
              </div>
            ) : null}
            {draft.lookup.alternatives?.length ? (
              <div className="study-auto-fill-section">
                <div className="section-label">自然表达</div>
                <div className="chip-row">
                  {draft.lookup.alternatives.map((item) => <span className="chip" key={item}>{item}</span>)}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="modal-footer">
          <button className="ghost-button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary-button" type="button" onClick={submit} disabled={saving || !draft.english.trim()}>
            {saving ? <Loader2 size={14} className="spin" /> : null}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageView(props: {
  message: ConversationMessage;
  onTokenLookup: (query: string, anchor: AnchorPoint, context: string) => void;
  onSelectionLookup: (query: string, anchor: AnchorPoint, context: string) => void;
}) {
  const { message, onTokenLookup, onSelectionLookup } = props;
  const tokens = useMemo(() => tokenize(message.content), [message.content]);

  const handleMouseUp = (event: MouseEvent<HTMLDivElement>) => {
    const selection = window.getSelection();
    const selected = selection?.toString().trim() || "";
    if (!selected) return;
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const rect = range?.getBoundingClientRect();
    if (rect) {
      onSelectionLookup(selected, {
        ...clampAnchor(rect.left, rect.bottom + 10),
      }, message.content);
    }
    event.stopPropagation();
  };

  return (
    <div className={`message-row ${message.role}`}>
      <div className="message-shell">
        <div className="message-bubble" onMouseUp={handleMouseUp}>
          {tokens.map((part, index) => {
            if (/^\s+$/.test(part)) {
              return <span key={`${part}-${index}`}>{part}</span>;
            }
            const token = normalizeToken(part);
            if (!token) {
              return <span key={`${part}-${index}`}>{part}</span>;
            }
            return (
              <span
                className="message-token message-token-clickable"
                key={`${part}-${index}`}
                onClick={(event) => {
                  const selected = window.getSelection()?.toString().trim() || "";
                  if (selected && selected.toLowerCase() !== token.toLowerCase()) return;
                  onTokenLookup(
                    token,
                    clampAnchor(
                      event.currentTarget.getBoundingClientRect().left,
                      event.currentTarget.getBoundingClientRect().bottom + 10,
                    ),
                    message.content,
                  );
                }}
              >
                {part}
              </span>
            );
          })}
        </div>
        {message.correction ? (
          <div className="correction-box">
            <div className="correction-row">
              <span className="correction-label">原句</span>
              <span>{message.correction.original}</span>
            </div>
            <div className="correction-row">
              <span className="correction-label">推荐</span>
              <span>{message.correction.recommended}</span>
            </div>
            <div className="correction-row">
              <span className="correction-label">原因</span>
              <span>{message.correction.reason}</span>
            </div>
            {message.correction.details?.length ? (
              <div className="correction-notes">
                {message.correction.details.map((item, index) => (
                  <div key={`${item}-${index}`}>{item}</div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("chat");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [conversationId, setConversationId] = useState<string>("");
  const [conversationTitle, setConversationTitle] = useState("新对话");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [studyItems, setStudyItems] = useState<StudyItem[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const [libraryFilter, setLibraryFilter] = useState("");
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupStatus, setLookupStatus] = useState("");
  const [hoverLookup, setHoverLookup] = useState<HoverLookupState | null>(null);
  const [detailLookup, setDetailLookup] = useState<LookupResult | null>(null);
  const [detailHistory, setDetailHistory] = useState<LookupResult[]>([]);
  const [detailReturnHover, setDetailReturnHover] = useState<HoverLookupState | null>(null);
  const [enrichingLookup, setEnrichingLookup] = useState(false);
  const [conversationEnvironment, setConversationEnvironment] = useState<ConversationEnvironment>(() => {
    const stored = window.localStorage.getItem("ela.conversationEnvironment") as ConversationEnvironment | null;
    return conversationEnvironmentOptions.some((item) => item.value === stored) ? stored! : "casual";
  });
  const [editorState, setEditorState] = useState<{ mode: "create" | "edit"; draft: StudyDraft } | null>(null);
  const [selectedStudyItem, setSelectedStudyItem] = useState<StudyItem | null>(null);
  const [translatingStudyItemId, setTranslatingStudyItemId] = useState<string | null>(null);
  const [studyTranslationMessage, setStudyTranslationMessage] = useState("");
  const [settingsDraft, setSettingsDraft] = useState({
    baseUrl: "",
    model: "",
    correctionMode: "light" as AppSettings["correctionMode"],
    apiKey: "",
  });
  const [settingsMessage, setSettingsMessage] = useState("");
  const lookupRequestRef = useRef(0);
  const messageListRef = useRef<HTMLDivElement>(null);
  const conversationViewRef = useRef(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const sentenceTranslationAttemptsRef = useRef(new Set<string>());

  const api = window.electronAPI;

  const loadConversation = async (id: string) => {
    const viewVersion = ++conversationViewRef.current;
    const history = await api.chat.history(id);
    if (viewVersion !== conversationViewRef.current) return;
    setMessages(history);
  };

  const refreshConversations = async () => {
    const next = await api.chat.list();
    setConversations(next);
    return next;
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [savedSettings, items, savedConversations] = await Promise.all([
        api.settings.get(),
        api.study.list(),
        api.chat.list(),
      ]);
      if (!mounted) return;
      setSettings(savedSettings);
      setSettingsDraft((current) => ({
        ...current,
        baseUrl: savedSettings.baseUrl,
        model: savedSettings.model,
        correctionMode: savedSettings.correctionMode,
      }));
      setStudyItems(items);
      setConversations(savedConversations);
      const storedConversationId = window.localStorage.getItem("ela.currentConversationId");
      const selectedConversation =
        savedConversations.find((conversation) => conversation.id === storedConversationId) ||
        savedConversations[0];
      if (selectedConversation) {
        setConversationId(selectedConversation.id);
        setConversationTitle(selectedConversation.title);
        await loadConversation(selectedConversation.id);
        window.localStorage.setItem("ela.currentConversationId", selectedConversation.id);
      } else {
        const conversation = await api.chat.conversation();
        if (!mounted) return;
        setConversationId(conversation.id);
        setConversationTitle(conversation.title);
        setConversations([conversation]);
        window.localStorage.setItem("ela.currentConversationId", conversation.id);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList) return;
    const frame = window.requestAnimationFrame(() => {
      messageList.scrollTo({
        top: messageList.scrollHeight,
        behavior: "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages.length]);

  const refreshStudyItems = async () => {
    setStudyItems(await api.study.list());
  };

  const runLookup = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return null;
    const requestId = ++lookupRequestRef.current;
    setLookupLoading(true);
    setLookupStatus("");
    try {
      const result = await api.dictionary.lookup({ query: trimmed });
      if (requestId !== lookupRequestRef.current) return result;
      return result;
    } finally {
      if (requestId === lookupRequestRef.current) {
        setLookupLoading(false);
      }
    }
  };

  const openLookupDetail = (result: LookupResult) => {
    setDetailHistory([]);
    setDetailReturnHover(null);
    setDetailLookup(result);
  };

  const hideHoverLookup = () => {
    lookupRequestRef.current += 1;
    setHoverLookup(null);
  };

  const handleTokenLookup = async (query: string, anchor: AnchorPoint, context: string) => {
    const normalized = normalizeToken(query);
    if (!normalized) return;
    const requestId = ++lookupRequestRef.current;
    setLookupLoading(true);
    try {
      const result = await api.dictionary.lookup({ query: normalized, context });
      if (requestId !== lookupRequestRef.current) return;
      setHoverLookup({
        result,
        anchor,
        relatedPhrases: extractRelatedPhrases(context, normalized),
        context,
      });
    } finally {
      if (requestId === lookupRequestRef.current) {
        setLookupLoading(false);
      }
    }
  };

  const handleSelectionLookup = async (query: string, anchor: AnchorPoint, context: string) => {
    const requestId = ++lookupRequestRef.current;
    setLookupLoading(true);
    try {
      const result = await api.dictionary.lookup({ query, context });
      if (requestId === lookupRequestRef.current) {
        setHoverLookup({ result, anchor, relatedPhrases: [], context });
      }
    } finally {
      if (requestId === lookupRequestRef.current) {
        setLookupLoading(false);
      }
    }
  };

  const lookupPhraseDetail = async (query: string, context?: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const requestId = ++lookupRequestRef.current;
    if (detailLookup) {
      setDetailHistory((current) => [...current, detailLookup]);
    }
    setLookupLoading(true);
    try {
      const result = await api.dictionary.lookup({ query: trimmed, context });
      if (requestId === lookupRequestRef.current) {
        setDetailLookup(result);
      }
    } finally {
      if (requestId === lookupRequestRef.current) {
        setLookupLoading(false);
      }
    }
  };

  const openDetailFromQuickLookup = (lookup: HoverLookupState) => {
    setDetailHistory([]);
    setDetailReturnHover(lookup);
    setDetailLookup(lookup.result);
    hideHoverLookup();
  };

  const goBackFromDetail = () => {
    const previous = detailHistory[detailHistory.length - 1];
    if (previous) {
      setDetailHistory((current) => current.slice(0, -1));
      setDetailLookup(previous);
      return;
    }
    if (detailReturnHover) {
      setHoverLookup(detailReturnHover);
      setDetailReturnHover(null);
      setDetailLookup(null);
      return;
    }
    setDetailLookup(null);
  };

  const startNewConversation = async () => {
    const conversation = await api.chat.conversation();
    conversationViewRef.current += 1;
    setConversationId(conversation.id);
    setConversationTitle(conversation.title);
    setMessages([]);
    setChatInput("");
    setHoverLookup(null);
    setDetailLookup(null);
    setConversations((current) => [conversation, ...current]);
    setActiveTab("chat");
    window.localStorage.setItem("ela.currentConversationId", conversation.id);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  const selectConversation = async (conversation: Conversation) => {
    if (conversation.id === conversationId) {
      setActiveTab("chat");
      return;
    }
    conversationViewRef.current += 1;
    setConversationId(conversation.id);
    setConversationTitle(conversation.title);
    setActiveTab("chat");
    setMessages([]);
    setChatInput("");
    setHoverLookup(null);
    setDetailLookup(null);
    window.localStorage.setItem("ela.currentConversationId", conversation.id);
    await loadConversation(conversation.id);
  };

  const removeConversation = async (conversation: Conversation) => {
    if (!window.confirm(`删除对话“${conversation.title}”？`)) return;
    await api.chat.delete(conversation.id);
    conversationViewRef.current += 1;
    const remaining = await refreshConversations();
    if (conversation.id !== conversationId) return;

    const next = remaining[0];
    if (next) {
      await selectConversation(next);
      return;
    }
    setConversationId("");
    setConversationTitle("新对话");
    setMessages([]);
    setChatInput("");
    setHoverLookup(null);
    setDetailLookup(null);
    setDetailHistory([]);
    setDetailReturnHover(null);
    setActiveTab("chat");
    window.localStorage.removeItem("ela.currentConversationId");
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  const sendChat = async () => {
    const content = chatInput.trim();
    if (!content) return;
    setSending(true);
    try {
      let activeConversationId = conversationId;
      if (!activeConversationId) {
        const conversation = await api.chat.conversation();
        conversationViewRef.current += 1;
        activeConversationId = conversation.id;
        setConversationId(conversation.id);
        setConversationTitle(conversation.title);
        setConversations((current) => [conversation, ...current]);
        window.localStorage.setItem("ela.currentConversationId", conversation.id);
      }
      const requestViewVersion = conversationViewRef.current;
      const response = await api.chat.send({
        conversationId: activeConversationId,
        content,
        correctionMode: settings?.correctionMode ?? "light",
        environment: conversationEnvironment,
      });
      const responseConversationId = response.conversationId || activeConversationId;
      if (requestViewVersion !== conversationViewRef.current) {
        await refreshConversations();
        return;
      }
      await loadConversation(responseConversationId);
      const refreshedConversations = await refreshConversations();
      const currentConversation = refreshedConversations.find(
        (conversation) => conversation.id === responseConversationId,
      );
      if (currentConversation) {
        setConversationTitle(currentConversation.title);
      }
      setChatInput("");
      setConversationId(responseConversationId);
      window.localStorage.setItem("ela.currentConversationId", responseConversationId);
    } finally {
      setSending(false);
    }
  };

  const saveStudyDraft = async (draft: StudyDraft) => {
    const payload = {
      type: draft.type,
      english: draft.english.trim(),
      chineseMeaning: draft.chineseMeaning.trim() || undefined,
      source: draft.source,
      tags: [],
      note: "",
      lookup: draft.lookup,
    };
    if (draft.id) {
      await api.study.update({ id: draft.id, ...payload });
    } else {
      await api.study.create(payload);
    }
    await refreshStudyItems();
  };

  const saveLookupToLibrary = async (result: LookupResult) => {
    setEditorState({
      mode: "create",
      draft: deriveStudyDraftFromLookup(result),
    });
  };

  const autoLookupStudy = async (english: string) => {
    return api.dictionary.lookup({ query: english });
  };

  const enrichStudyLookup = async (base: LookupResult, english: string) => {
    const enriched = await api.dictionary.enrich({
      query: english,
      direction: base.direction,
      base,
    });
    if (!enriched.found) {
      throw new Error(enriched.message || "AI 暂时没有返回补充内容");
    }
    return mergeLookupResults(base, enriched);
  };

  const enrichLookup = async (result: LookupResult) => {
    setEnrichingLookup(true);
    try {
      const enriched = await api.dictionary.enrich({
        query: result.query,
        direction: result.direction,
        base: result,
      });
      if (enriched.found) {
        setDetailLookup(enriched);
        setLookupResult((current) => (current?.query === result.query ? enriched : current));
        setLookupStatus("AI 已补充用法");
      } else {
        setLookupStatus(enriched.message || "AI 暂时没有返回补充内容");
      }
    } finally {
      setEnrichingLookup(false);
    }
  };

  const saveSettings = async () => {
    const payload: {
      baseUrl: string;
      model: string;
      correctionMode: AppSettings["correctionMode"];
      apiKey?: string;
    } = {
      baseUrl: settingsDraft.baseUrl.trim(),
      model: settingsDraft.model.trim(),
      correctionMode: settingsDraft.correctionMode,
    };
    if (settingsDraft.apiKey.trim()) {
      payload.apiKey = settingsDraft.apiKey.trim();
    }
    const saved = await api.settings.save(payload);
    setSettings(saved);
    setSettingsMessage("设置已保存");
    setSettingsDraft((current) => ({ ...current, apiKey: "" }));
  };

  const testConnection = async () => {
    const result = await api.settings.testConnection();
    setSettingsMessage(result.message);
  };

  const filteredItems = useMemo(() => {
    const q = libraryFilter.trim().toLowerCase();
    if (!q) return studyItems;
    return studyItems.filter((item) => {
      const haystack = [item.english, item.chineseMeaning || ""].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [studyItems, libraryFilter]);

  const openStudyEditor = (item: StudyItem) => {
    setSelectedStudyItem(null);
    setStudyTranslationMessage("");
    setEditorState({ mode: "edit", draft: deriveStudyDraftFromItem(item) });
  };

  const translateSentenceItem = async (item: StudyItem) => {
    const result = await api.dictionary.lookup({ query: item.english, direction: "en-zh" });
    const chineseMeaning = lookupChineseMeaning(result);
    if (!result.found || !chineseMeaning) return { updated: null, message: result.message || "暂时没有获得中文翻译，请稍后重试。" };

    const updated = await api.study.update({
      id: item.id,
      type: "sentence",
      chineseMeaning,
      lookup: result,
      source: result.source,
      tags: [],
      note: "",
    });
    setStudyItems((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
    setSelectedStudyItem((current) => (current?.id === updated.id ? updated : current));
    return { updated, message: "" };
  };

  const openStudyDetail = async (item: StudyItem) => {
    setSelectedStudyItem(item);
    setStudyTranslationMessage("");
    const existingMeaning = item.chineseMeaning || item.lookup?.translation;
    if (item.type !== "sentence" || existingMeaning || translatingStudyItemId === item.id) return;

    setTranslatingStudyItemId(item.id);
    try {
      const outcome = await translateSentenceItem(item);
      if (!outcome.updated) setStudyTranslationMessage(outcome.message);
    } catch (error) {
      setStudyTranslationMessage(`翻译失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTranslatingStudyItemId((current) => (current === item.id ? null : current));
    }
  };

  useEffect(() => {
    const pending = studyItems.filter(
      (item) =>
        item.type === "sentence" &&
        !item.chineseMeaning &&
        !item.lookup?.translation &&
        !sentenceTranslationAttemptsRef.current.has(item.id),
    );
    if (!pending.length) return;
    pending.forEach((item) => sentenceTranslationAttemptsRef.current.add(item.id));
    void (async () => {
      for (const item of pending) {
        try {
          await translateSentenceItem(item);
        } catch {
          // Keep the original card available when an automatic retry cannot reach AI.
        }
      }
    })();
  }, [studyItems]);

  const deleteStudyItem = async (item: StudyItem) => {
    if (!window.confirm(`删除“${item.english}”？`)) return;
    setSelectedStudyItem((current) => (current?.id === item.id ? null : current));
    await api.study.delete(item.id);
    await refreshStudyItems();
  };

  const renderChat = () => (
    <div className="tab-panel chat-panel">
      <div className="panel-bar">
          <div className="panel-title-block">
            <div className="panel-title">{conversationTitle}</div>
        </div>
        <div className="panel-actions">
          <label className="environment-control">
            <span>场景</span>
            <select
              className="environment-select"
              value={conversationEnvironment}
              onChange={(event) => {
                const next = event.target.value as ConversationEnvironment;
                setConversationEnvironment(next);
                window.localStorage.setItem("ela.conversationEnvironment", next);
              }}
            >
              {conversationEnvironmentOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button className="ghost-button" type="button" onClick={startNewConversation}>
            <Plus size={14} />
            新建
          </button>
        </div>
      </div>
      <div className="message-list" ref={messageListRef}>
        {messages.length ? (
          messages.map((message) => (
            <MessageView
              key={message.id}
              message={message}
              onTokenLookup={handleTokenLookup}
              onSelectionLookup={handleSelectionLookup}
            />
          ))
          ) : (
          <div className="empty-state">
            <MessageSquareText size={28} />
            <div className="empty-title">还没有消息</div>
          </div>
        )}
      </div>
      <div className="composer">
        <textarea
          ref={composerRef}
          value={chatInput}
          onChange={(event) => setChatInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void sendChat();
            }
          }}
          placeholder="在这里输入英文"
          rows={4}
        />
        <div className="composer-row">
          <div className="composer-hint">{sending ? "发送中..." : "回车发送，Shift+Enter 换行"}</div>
          <button className="primary-button" type="button" onClick={sendChat} disabled={sending || !chatInput.trim()}>
            {sending ? <Loader2 size={14} className="spin" /> : <ArrowRight size={14} />}
            发送
          </button>
        </div>
      </div>
    </div>
  );

  const renderLibrary = () => (
    <div className="tab-panel">
      <div className="panel-bar">
        <div className="panel-title-block">
          <div className="panel-title">词库</div>
          <div className="panel-subtitle">{filteredItems.length} 条</div>
        </div>
        <div className="panel-actions">
          <div className="search-box">
            <Search size={14} />
            <input value={libraryFilter} onChange={(event) => setLibraryFilter(event.target.value)} placeholder="筛选" />
          </div>
          <button className="ghost-button" type="button" onClick={() => setEditorState({ mode: "create", draft: initialDraft })}>
            <Plus size={14} />
            新增
          </button>
        </div>
      </div>
      <div className="item-list study-card-grid">
        {filteredItems.length ? (
          filteredItems.map((item) => {
            const lookup = item.lookup;
            const chineseMeaning = item.chineseMeaning || lookup?.translation || lookup?.senses[0]?.meaning || "暂未添加中文释义";
            const previewSense = item.type !== "sentence" ? lookup?.senses.find((sense) => sense.englishDefinition) : undefined;
            const previewExample = item.type !== "sentence" ? lookup?.examples[0] : undefined;
            return (
              <article
                className={`study-card study-card-${item.type}`}
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => void openStudyDetail(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void openStudyDetail(item);
                  }
                }}
              >
                <div className="study-card-top">
                  <span className="item-type">{item.type === "word" ? "单词" : item.type === "phrase" ? "短语" : "句子"}</span>
                  <div className="study-card-actions">
                    <button
                      className="icon-button"
                      type="button"
                      aria-label="编辑"
                      onClick={(event) => {
                        event.stopPropagation();
                        openStudyEditor(item);
                      }}
                    >
                      <Settings2 size={14} />
                    </button>
                    <button
                      className="icon-button danger"
                      type="button"
                      aria-label="删除"
                      onClick={(event) => {
                        event.stopPropagation();
                        void deleteStudyItem(item);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="study-card-english">{item.english}</div>
                <div className="study-card-chinese">{chineseMeaning}</div>
                {previewSense?.englishDefinition ? (
                  <div className="study-card-section">
                    <div className="study-card-label">英文释义</div>
                    <div>{previewSense.englishDefinition}</div>
                  </div>
                ) : null}
                {previewExample ? (
                  <div className="study-card-section study-card-example">
                    <div className="study-card-label">例句</div>
                    <div>{previewExample.english}</div>
                  </div>
                ) : null}
                {lookup?.synonyms?.length ? (
                  <div className="study-card-chips">
                    {lookup.synonyms.slice(0, 3).map((synonym) => <span key={synonym}>{synonym}</span>)}
                  </div>
                ) : null}
              </article>
            );
          })
        ) : (
          <div className="empty-state">
            <BookOpen size={28} />
            <div className="empty-title">词库为空</div>
          </div>
        )}
      </div>
    </div>
  );

  const renderLookup = () => (
    <div className="tab-panel">
      <div className="panel-bar">
        <div className="panel-title-block">
          <div className="panel-title">查词</div>
          <div className="panel-subtitle">{lookupStatus || "本地词典 · AI 兜底"}</div>
        </div>
        <div className="panel-actions">
          <div className="search-box">
            <Search size={14} />
            <input value={lookupQuery} onChange={(event) => setLookupQuery(event.target.value)} placeholder="输入单词或短语" />
          </div>
          <button
            className="ghost-button"
            type="button"
            onClick={async () => {
              const result = await runLookup(lookupQuery);
              if (result) {
                setLookupResult(result);
                setLookupStatus(lookupStatusLabel(result));
              }
            }}
            disabled={lookupLoading || !lookupQuery.trim()}
          >
            {lookupLoading ? <Loader2 size={14} className="spin" /> : <Search size={14} />}
            查询
          </button>
        </div>
      </div>
      <div className="lookup-layout">
        <div className="lookup-result">
          {lookupResult ? (
            <>
              <div className="lookup-result-header">
                <div>
                  <div className="lookup-result-title">{lookupResult.headword || lookupResult.query}</div>
                  <div className="lookup-result-sub">
                    {lookupResult.pronunciation ||
                      sourceLabel(lookupResult.source)}
                  </div>
                </div>
                <div className="lookup-result-actions">
                  <button className="ghost-button" type="button" onClick={() => openLookupDetail(lookupResult)} disabled={!lookupResult.found}>
                    详情
                  </button>
                  <button className="ghost-button" type="button" onClick={() => saveLookupToLibrary(lookupResult)} disabled={!lookupResult.found}>
                    收藏
                  </button>
                </div>
              </div>
              {lookupResult.found ? (
                <>
                  {lookupResult.translation ? (
                    <div className="lookup-inline lookup-translation-block">
                      <div className="section-label">中文翻译</div>
                      <div className="study-detail-translation">{lookupResult.translation}</div>
                    </div>
                  ) : null}
                  <div className="sense-list">
                    {lookupResult.senses.map((sense, index) => (
                      <div className="sense-row" key={`${sense.meaning}-${index}`}>
                          <div className="sense-pos">{sense.partOfSpeech || "词性"}</div>
                        <div>
                          <div className="sense-meaning">{sense.meaning}</div>
                          {sense.englishDefinition ? <div className="sense-def">{sense.englishDefinition}</div> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="lookup-inline">
                    <div className="section-label">例句</div>
                    {lookupResult.examples.map((example, index) => (
                      <div className="example-row" key={`${example.english}-${index}`}>
                        <div className="example-en">{example.english}</div>
                        {example.chinese ? <div className="example-zh">{example.chinese}</div> : null}
                      </div>
                    ))}
                  </div>
                  {lookupResult.alternatives?.length ? (
                    <div className="lookup-inline">
                      <div className="section-label">自然表达</div>
                      <div className="chip-row">
                        {lookupResult.alternatives.map((item) => (
                          <span className="chip" key={item}>
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {lookupResult.collocations.length ? (
                    <div className="lookup-inline">
                      <div className="section-label">常见搭配</div>
                      <div className="chip-row">
                        {lookupResult.collocations.map((item) => (
                          <button className="chip chip-button" type="button" key={item} onClick={() => void lookupPhraseDetail(item, lookupResult.query)}>
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {lookupResult.synonyms?.length ? (
                    <div className="lookup-inline">
                      <div className="section-label">近义词</div>
                      <div className="chip-row">
                        {lookupResult.synonyms.map((item) => (
                          <button className="chip chip-button" type="button" key={item} onClick={() => void lookupPhraseDetail(item, lookupResult.query)}>
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="empty-state compact">
                    <div className="empty-title">{lookupResult.message || "未找到对应词条"}</div>
                </div>
              )}
              {!lookupResult.found ? (
                <div className="lookup-help">
                  <div className="muted">本地词库未找到时会自动尝试 AI。若 AI 未配置或暂时不可用，请到“设置”填写 DeepSeek 密钥。</div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="empty-state">
              <Search size={28} />
              <div className="empty-title">输入单词或词组开始查词</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="tab-panel">
      <div className="panel-bar">
        <div className="panel-title-block">
          <div className="panel-title">设置</div>
          <div className="panel-subtitle">{settings?.hasApiKey ? "密钥已保存" : "尚未填写密钥"}</div>
        </div>
      </div>
      <div className="form-grid settings-grid">
        <label className="field field-span">
          <span>接口地址</span>
          <input
            value={settingsDraft.baseUrl}
            onChange={(event) => setSettingsDraft((current) => ({ ...current, baseUrl: event.target.value }))}
          />
        </label>
        <label className="field field-span">
          <span>模型</span>
          <input
            value={settingsDraft.model}
            onChange={(event) => setSettingsDraft((current) => ({ ...current, model: event.target.value }))}
          />
        </label>
        <label className="field">
          <span>纠错模式</span>
          <select
            value={settingsDraft.correctionMode}
            onChange={(event) =>
              setSettingsDraft((current) => ({
                ...current,
                correctionMode: event.target.value as AppSettings["correctionMode"],
              }))
            }
          >
            <option value="light">轻量</option>
            <option value="detailed">详细</option>
          </select>
        </label>
        <label className="field field-span">
          <span>DeepSeek 密钥</span>
          <input
            value={settingsDraft.apiKey}
            onChange={(event) => setSettingsDraft((current) => ({ ...current, apiKey: event.target.value }))}
            type="password"
            placeholder="留空则保持当前密钥"
          />
        </label>
      </div>
      <div className="settings-actions">
        <div className="muted">{settingsMessage}</div>
        <div className="settings-action-group">
          <button className="ghost-button" type="button" onClick={testConnection}>
            测试连接
          </button>
          <button className="primary-button" type="button" onClick={saveSettings}>
            保存设置
          </button>
        </div>
      </div>
    </div>
  );

  const renderTab = () => {
    switch (activeTab) {
      case "library":
        return renderLibrary();
      case "lookup":
        return renderLookup();
      case "settings":
        return renderSettings();
      default:
        return renderChat();
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={18} />
          </div>
          <div className="brand-title">英语学习助手</div>
        </div>
        <section className="conversation-section">
          <div className="conversation-list-header">
            <span>对话</span>
            <button
              className="icon-button sidebar-new-button"
              type="button"
              onClick={startNewConversation}
              aria-label="新建对话"
              title="新建对话"
            >
              <Plus size={15} />
            </button>
          </div>
          <div className="conversation-list">
            {conversations.map((conversation) => (
              <div
                className={`conversation-item ${conversation.id === conversationId ? "active" : ""}`}
                key={conversation.id}
              >
                <button
                  className="conversation-select"
                  type="button"
                  onClick={() => void selectConversation(conversation)}
                  title={conversation.title}
                >
                  <MessageSquareText size={14} />
                  <span>{conversation.title}</span>
                </button>
                <button
                  className="conversation-delete"
                  type="button"
                  onClick={() => void removeConversation(conversation)}
                  aria-label={`删除${conversation.title}`}
                  title="删除对话"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </section>
        <nav className="nav-list">
          {([
            ["library", "词库", BookOpen],
            ["lookup", "查词", Search],
            ["settings", "设置", Settings2],
          ] as Array<[TabKey, string, LucideIcon]>).map(([key, label, Icon]) => (
            <button
              key={key}
              className={`nav-item ${activeTab === key ? "active" : ""}`}
              type="button"
              onClick={() => setActiveTab(key)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="workspace">{renderTab()}</main>

      {hoverLookup ? (
        <QuickLookupPopover
          result={hoverLookup.result}
          anchor={hoverLookup.anchor}
          relatedPhrases={hoverLookup.relatedPhrases}
          collocations={hoverLookup.result.collocations.filter(
            (collocation) => !hoverLookup.relatedPhrases.some((phrase) => phrase.toLowerCase() === collocation.toLowerCase()),
          )}
          onPhraseLookup={(phrase) => {
            const context = hoverLookup.context;
            const parentLookup = hoverLookup;
            setDetailHistory([]);
            setDetailReturnHover(parentLookup);
            hideHoverLookup();
            void lookupPhraseDetail(phrase, context);
          }}
          onDetails={() => {
            openDetailFromQuickLookup(hoverLookup);
          }}
          onAdd={() => {
            saveLookupToLibrary(hoverLookup.result);
            hideHoverLookup();
          }}
          onClose={hideHoverLookup}
        />
      ) : null}

      {detailLookup ? (
        <DetailModal
          result={detailLookup}
          onClose={() => {
            setDetailLookup(null);
            setDetailHistory([]);
            setDetailReturnHover(null);
          }}
          onBack={detailHistory.length || detailReturnHover ? goBackFromDetail : undefined}
          onAdd={() => saveLookupToLibrary(detailLookup)}
          onPhraseLookup={(phrase) => void lookupPhraseDetail(phrase)}
          onEnrich={() => void enrichLookup(detailLookup)}
          enriching={enrichingLookup}
        />
      ) : null}

      {selectedStudyItem ? (
        <StudyDetailModal
          item={selectedStudyItem}
          translating={translatingStudyItemId === selectedStudyItem.id}
          translationMessage={studyTranslationMessage}
          onClose={() => {
            setSelectedStudyItem(null);
            setStudyTranslationMessage("");
          }}
          onEdit={() => openStudyEditor(selectedStudyItem)}
        />
      ) : null}

      <StudyEditorModal
        open={editorState !== null}
        initial={editorState?.draft || initialDraft}
        mode={editorState?.mode || "create"}
        onClose={() => setEditorState(null)}
        onSave={saveStudyDraft}
        onAutoLookup={autoLookupStudy}
        onEnrichLookup={enrichStudyLookup}
      />

      {lookupLoading && activeTab !== "lookup" ? (
        <div className="status-pill">
          <Loader2 size={14} className="spin" />
          查词中
        </div>
      ) : null}
    </div>
  );
}
