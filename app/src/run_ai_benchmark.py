import json
import os
import re
import statistics
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests
from dotenv import load_dotenv
from pydantic import BaseModel, Field, ValidationError, field_validator

# Optional Supabase support
try:
    from supabase import create_client
except ImportError:
    create_client = None

load_dotenv()

print("OPENAI:", "OK" if os.getenv("OPENAI_API_KEY") else "MISSING")
print("ANTHROPIC:", "OK" if os.getenv("ANTHROPIC_API_KEY") else "MISSING")
print("SUPABASE_URL:", "OK" if os.getenv("SUPABASE_URL") else "MISSING")
print("SUPABASE_SERVICE_ROLE_KEY:", "OK" if os.getenv("SUPABASE_SERVICE_ROLE_KEY") else "MISSING")


# ---------- Config ----------

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5.4")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-opus-4-6")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

OUTPUT_DIR = "outputs"
os.makedirs(OUTPUT_DIR, exist_ok=True)

PROMPT_VERSION = "v2_profiles_critique"

SUPABASE_ENABLED = bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and create_client)

supabase = None
if SUPABASE_ENABLED:
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    print("SUPABASE: ENABLED")
else:
    print("SUPABASE: DISABLED")


# ---------- Schema ----------

class ForecastResponse(BaseModel):
    probability: int = Field(description="Integer from 0 to 100")
    rationale: str = Field(description="Max 3 sentences")
    assumptions: List[str] = Field(description="2 to 5 short assumptions")
    confidence: float = Field(description="Number from 0 to 1")

    @field_validator("probability")
    @classmethod
    def validate_probability(cls, v: int) -> int:
        if not 0 <= v <= 100:
            raise ValueError("probability must be between 0 and 100")
        return v

    @field_validator("confidence")
    @classmethod
    def validate_confidence(cls, v: float) -> float:
        if not 0 <= v <= 1:
            raise ValueError("confidence must be between 0 and 1")
        return v

    @field_validator("assumptions")
    @classmethod
    def validate_assumptions(cls, v: List[str]) -> List[str]:
        if not 2 <= len(v) <= 5:
            raise ValueError("assumptions must have 2 to 5 items")
        return v


FORECAST_JSON_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "probability": {"type": "integer", "minimum": 0, "maximum": 100},
        "rationale": {"type": "string"},
        "assumptions": {
            "type": "array",
            "minItems": 2,
            "maxItems": 5,
            "items": {"type": "string"},
        },
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
    },
    "required": ["probability", "rationale", "assumptions", "confidence"],
}


# ---------- Inputs ----------
# Questions are fetched dynamically from public.signals at runtime (see fetch_questions()).

PROFILES = {
    "base": {
        "label": "Base",
        "prompt": """You are a balanced forecaster synthesizing two opposing views: a skeptical deployment view and an optimistic capability view.

Your job is to reconcile them into a calibrated final probability.

Required in your reasoning:
1. State the single strongest upside driver (why this could happen)
2. State the single strongest downside driver (why this could fail)
3. Explain why your final probability sits between the optimistic and skeptical extremes — or, if it doesn't, explain what makes the evidence one-sided

Do not let either view dominate without justification. Aim for the probability that best reflects the actual balance of evidence.""",
    },

    "investor": {
        "label": "Investor",
        "prompt": """You are a skeptical investor. Your prior is that technical capability does not translate into enterprise deployment on the same timeline.

Reason from:
- Switching costs and integration burden: who has to change workflows, systems, or contracts
- Compliance and reliability requirements: what certifications, SLAs, or liability constraints block adoption
- Procurement and budget cycles: how long enterprise buying actually takes
- Historical overestimation: AI and software timelines routinely slip 2–5x; assume this holds unless you have strong evidence otherwise

Required in your reasoning:
- Argue specifically why technical capability may NOT translate to deployment on this timeline
- Name the most likely bottleneck (organizational, regulatory, economic, or technical)
- State your skeptical adjustment: why your probability is lower than a naive capability-based estimate would suggest""",
    },

    "researcher": {
        "label": "Researcher",
        "prompt": """You are an optimistic ML researcher. Your prior is that benchmark progress is a leading indicator of real-world capability, and that technical capability advances faster than business adoption expects.

Reason from:
- Benchmark convergence: how quickly models are closing gaps on relevant tasks
- Scaling trends: compute, data, and algorithmic efficiency improvements over the horizon
- Architecture improvements: new methods that change the capability trajectory
- Open-weight catch-up dynamics: how open models narrow proprietary leads and accelerate accessibility

Required in your reasoning:
- Argue specifically why technical capability may advance faster than business adoption timelines suggest
- Name the most likely capability accelerant (a scaling trend, architectural shift, or open-weight dynamic)
- State your optimistic adjustment: why your probability is higher than a deployment-friction-focused estimate would suggest""",
    },
}

# Start small. Add Anthropic later once OpenAI works.
PROVIDERS = ["openai"]
RUNS_PER_PROVIDER = 3
SLEEP_SECONDS = 3.0

PROFILE_WEIGHTS: Dict[str, float] = {"investor": 0.4, "base": 0.3, "researcher": 0.3}


# ---------- Prompting ----------

SYSTEM_PROMPT = """You are making a calibrated probabilistic forecast.

Return JSON only.
Do not use markdown fences.
Do not hedge with ranges.
Use the exact deadline and resolution criteria.
Avoid overconfidence.
"""

def build_evidence_brief_prompt(question: Dict[str, str]) -> str:
    return f"""Before a probabilistic forecast is made on the following question, provide a short evidence brief.

Question:
{question["text"]}

Deadline: {question["deadline"]}
Domain: {question["domain"]}

Summarize the most relevant facts, trends, and data points a forecaster should know. Include:
- Recent developments that bear directly on this question
- Historical base rates or analogous outcomes if applicable
- Key uncertainties or contested claims
- Any known milestones or deadlines relevant to resolution

Be concise and factual. 150–250 words. Plain text only.""".strip()


def generate_evidence_brief(provider: str, question: Dict[str, str]) -> str:
    """Generate a short evidence brief for a question using the LLM's knowledge."""
    try:
        brief = _call_raw_text(
            provider,
            system="You are a research analyst preparing background context for a forecasting exercise.",
            user=build_evidence_brief_prompt(question),
        )
        return brief.strip()
    except Exception as e:
        print(f"  [WARN] Evidence brief generation failed ({e}), proceeding without it")
        return ""


def _evidence_block(evidence_brief: str) -> str:
    if not evidence_brief:
        return ""
    return f"\nEvidence brief:\n{evidence_brief}\n"


def build_initial_user_prompt(
    question: Dict[str, str],
    profile_name: str,
    profile_instruction: str,
    evidence_brief: str = "",
) -> str:
    return f"""Question:
{question["text"]}

Resolution criteria:
{question["resolution_criteria"]}

Deadline:
{question["deadline"]}

Domain:
{question["domain"]}
{_evidence_block(evidence_brief)}
Profile: {profile_name}
{profile_instruction}

Requirements:
- Your rationale MUST cite at least one specific fact or trend from the evidence brief above.
- At least one assumption must be grounded in a specific piece of evidence from the brief.
- Do not reason generically. If your rationale could apply to any question without reading the evidence, it is not acceptable.

Return JSON with exactly these fields:
- probability: integer from 0 to 100
- rationale: string, max 3 sentences — must include: what evidence most influenced your estimate and why
- assumptions: array of 2 to 5 short strings — at least one must reference a specific fact from the evidence brief
- confidence: number from 0 to 1""".strip()


def build_critique_prompt(
    question: Dict[str, str],
    initial_parsed: Dict[str, Any],
    evidence_brief: str = "",
) -> str:
    return f"""Review this probabilistic forecast for the question:

"{question["text"]}"
{_evidence_block(evidence_brief)}
Forecast:
- probability: {initial_parsed["probability"]}
- rationale: {initial_parsed["rationale"]}
- assumptions: {json.dumps(initial_parsed["assumptions"])}
- confidence: {initial_parsed["confidence"]}

Critique it. Be specific and direct about:
1. Weak or underexamined assumptions
2. Overconfidence or underconfidence (is the confidence score justified?)
3. Important factors that were ignored or underweighted
4. Any reasoning errors or anchoring bias
5. Whether the rationale and assumptions actually engage with the evidence brief, or rely on generic reasoning that ignores it

Plain text only. No JSON.""".strip()


def build_revision_prompt(
    question: Dict[str, str],
    profile_name: str,
    profile_instruction: str,
    initial_parsed: Dict[str, Any],
    critique_text: str,
    evidence_brief: str = "",
) -> str:
    return f"""You made an initial forecast and received a critique. Produce a revised forecast.

Question:
{question["text"]}

Resolution criteria:
{question["resolution_criteria"]}

Deadline:
{question["deadline"]}
{_evidence_block(evidence_brief)}
Profile: {profile_name}
{profile_instruction}

Your initial forecast:
- probability: {initial_parsed["probability"]}
- rationale: {initial_parsed["rationale"]}
- assumptions: {json.dumps(initial_parsed["assumptions"])}
- confidence: {initial_parsed["confidence"]}

Critique:
{critique_text}

Revision rules:
- Only change probability if the critique identifies a specific flaw in the reasoning that justifies it.
- Any probability change must be grounded in a specific fact from the evidence brief — not a general reframing.
- Sharpen assumptions: remove vague ones, add any the critique flagged as missing; at least one must cite specific evidence.
- If the critique identifies overconfidence, lower the confidence score accordingly.
- Do not change the probability just to appear responsive to the critique.

Return JSON with exactly these fields:
- probability: integer from 0 to 100
- rationale: string, max 3 sentences — must cite what evidence most influenced the estimate
- assumptions: array of 2 to 5 short strings — at least one must reference a specific fact from the evidence brief
- confidence: number from 0 to 1""".strip()


# ---------- Utilities ----------

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def strip_code_fences(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()

def extract_first_json_object(text: str) -> str:
    text = strip_code_fences(text)
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError(f"No JSON object found in response: {text[:300]}")
    return text[start:end + 1]

def _extract_openai_text(data: Dict[str, Any]) -> str:
    """
    Extract text from an OpenAI Responses API result.
    1. Tries top-level output_text.
    2. Walks output[].content[] — matches known type strings first, then any block with a text field.
    3. Raises ValueError with a full content-structure debug summary if nothing found.
    """
    if data.get("output_text"):
        return data["output_text"]

    known_types = {"output_text", "text"}
    fallback: Optional[str] = None

    for item in data.get("output", []):
        for block in item.get("content", []):
            text = block.get("text", "")
            if not text:
                continue
            if block.get("type") in known_types:
                return text          # preferred path
            if fallback is None:
                fallback = text      # accept any block with text as last resort

    if fallback:
        return fallback

    top_keys = list(data.keys())
    content_shapes = [
        {"output_type": item.get("type"), "content": [{"type": b.get("type"), "has_text": bool(b.get("text"))} for b in item.get("content", [])]}
        for item in data.get("output", [])
    ]
    raise ValueError(
        f"Could not extract text from OpenAI response. "
        f"status={data.get('status')!r} top_keys={top_keys} "
        f"output_structure={json.dumps(content_shapes)}"
    )

def validate_forecast(data: Dict[str, Any]) -> ForecastResponse:
    return ForecastResponse.model_validate(data)

def write_json(path: str, payload: Any) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

def _weighted_profile_avg(profile_avgs: Dict[str, float], weights: Dict[str, float]) -> Optional[float]:
    total_weight = sum(weights[p] for p in weights if p in profile_avgs)
    if not total_weight:
        return None
    val = sum(profile_avgs[p] * weights[p] for p in weights if p in profile_avgs) / total_weight
    return round(val, 1)


# Phrases that indicate model self-narration — filtered from user-facing synthesis fields.
_SELF_REF_PHRASES: tuple = (
    "i revise", "i adjust", "i lower", "i raise", "i maintain",
    "i increase", "i decrease", "i've ", "i've", "my probability",
    "the critique", "evidence brief", "evidence-brief", "initial forecast",
    "the revision", "i initially", "i update", "critique noted",
    "based on the critique", "based on the evidence",
    "lean-yes", "lean yes", "lean-no", "lean no",
    "final probability", "probability stays",
)

# Sentences starting with these patterns are first-person model narration
_FIRST_PERSON_SENTENCE_RE = re.compile(
    r"^(I\b|My\b|I've\b|I'll\b|I'd\b|I'm\b)",
    re.IGNORECASE,
)

# Inline first-person clauses to strip from mid-sentence
_FIRST_PERSON_CLAUSE_RE = re.compile(
    r",?\s*\b(and|but)\s+I\s+\w[^.!?]*"
    r"|\bI\s+(keep|think|estimate|place|assign|set|put|maintain|revise|adjust"
    r"|lower|raise|update|hold|use|arrive|get)\b[^.!?]*"
    r"|,?\s*so\s+my\s+\w[^.!?]*"
    r"|\bmy\s+(main|key|core|primary|central|overall|negative|positive|view|estimate|forecast|lean)\b[^.!?]*",
    re.IGNORECASE,
)

# Sentence endings that indicate a dangling/incomplete thought
_DANGLING_END_RE = re.compile(
    r"\b(but|and|or|yet|so|because|since|if|when|while)\s*[.!?]?\s*$",
    re.IGNORECASE,
)


def _strip_first_person(text: str) -> str:
    """
    Remove first-person model narration from rationale text.
    1. Drop whole sentences that start with I / My / I've / I'll / I'd.
    2. Strip inline first-person clauses (", and I estimate...", "but I keep...").
    Falls back to the original text if stripping removes everything.
    """
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    clean = [s for s in sentences if not _FIRST_PERSON_SENTENCE_RE.match(s.strip())]
    if not clean:
        clean = sentences  # nothing survived — keep original
    result = []
    for s in clean:
        s = _FIRST_PERSON_CLAUSE_RE.sub("", s).strip().rstrip(",").strip()
        if s:
            result.append(s)
    return " ".join(result) if result else text


def _clean_rationale(text: str, max_sentences: int = 2) -> str:
    """
    Strip model self-narration sentences from a rationale string and return
    at most max_sentences of the remaining content.
    Preserves the original meaning — only removes meta-commentary.
    """
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    kept = [
        s for s in sentences
        if not any(phrase in s.lower() for phrase in _SELF_REF_PHRASES)
    ]
    if not kept:
        kept = sentences[:1]  # nothing survived the filter — fall back to first sentence
    return " ".join(kept[:max_sentences]).strip()


def _first_sentence(text: str) -> str:
    """Return the first sentence of text, or the full text if no sentence boundary found."""
    for sep in (". ", "! ", "? "):
        idx = text.find(sep)
        if idx != -1:
            return text[: idx + 1].strip()
    return text.strip()


def _trim_phrase(text: str, max_words: int = 10) -> str:
    """Trim text to at most max_words words, removing trailing punctuation."""
    words = text.split()
    if len(words) <= max_words:
        return text.rstrip(".,;:")
    return " ".join(words[:max_words]).rstrip(".,;:")


_UNCERTAINTY_KEYWORDS = (
    "risk", "risks", "depends", "depending", "timing", "constraints",
    "whether", "uncertainty", "uncertain", "unclear", "hinges",
    "challenge", "challenges", "barrier", "barriers", "unknown",
)


def _best_uncertainty_sentence(text: str) -> str:
    """
    Return the best complete uncertainty sentence from text.
    Priority order:
      1. Sentence with uncertainty keyword, not dangling, not a driver/accelerant description
      2. Any clean non-dangling sentence (excluding driver descriptions)
      3. Any non-dangling sentence
      4. First clean sentence (last resort)
    """
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    clean = [s for s in sentences if not any(p in s.lower() for p in _SELF_REF_PHRASES)]
    if not clean:
        clean = sentences
    # Round 1: uncertainty keyword + complete + not a driver/accelerant sentence
    for s in clean:
        if (any(kw in s.lower() for kw in _UNCERTAINTY_KEYWORDS)
                and not _DANGLING_END_RE.search(s)
                and not _UNCERTAINTY_EXCLUDE_RE.search(s)):
            return s.strip()
    # Round 2: any complete non-driver sentence
    for s in clean:
        if not _DANGLING_END_RE.search(s) and not _UNCERTAINTY_EXCLUDE_RE.search(s):
            return s.strip()
    # Round 3: any non-dangling sentence
    for s in clean:
        if not _DANGLING_END_RE.search(s):
            return s.strip()
    # Round 4: fallback to first clean sentence
    return clean[0].strip() if clean else text.strip()


_IMPLICATION_SKIP_RE = re.compile(
    r"\b(\d+%|probability|estimate|forecast|baseline|percent)\b",
    re.IGNORECASE,
)


def _best_implication_sentence(text: str) -> str:
    """
    Return the most conclusion-like sentence from text for use as implication.
    Prefers the last clean sentence (base rationale conclusions tend to appear last).
    Skips dangling sentences, first-person remnants, and sentences with internal
    estimate language (%, probability, forecast).
    """
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    clean = [
        s for s in sentences
        if not any(p in s.lower() for p in _SELF_REF_PHRASES)
        and not _DANGLING_END_RE.search(s)
        and not _IMPLICATION_SKIP_RE.search(s)
    ]
    if not clean:
        # Relax: allow estimate language but still require no dangling end
        clean = [s for s in sentences if not _DANGLING_END_RE.search(s)]
    if not clean:
        clean = sentences
    return clean[-1].strip() if clean else text.strip()


def _to_noun_phrase(sentence: str, max_words: int = 10) -> str:
    """
    Convert a sentence to a compact noun phrase fragment.
    Strips leading articles/demonstratives where safe.
    Falls back to a trimmed sentence fragment if stripping produces awkward output.
    """
    stripped = re.sub(
        r"^(The|This|A|An|Its|Their|These|Those)\s+",
        "",
        sentence,
        flags=re.IGNORECASE,
    )
    # If the stripped result would start with a conjugated verb, reinstate original
    _verb_re = re.compile(
        r"^(is|are|was|were|has|have|had|does|did|will|would|can|could|should|may|might)\b",
        re.IGNORECASE,
    )
    first_word = stripped.split()[0] if stripped.split() else ""
    if _verb_re.match(first_word):
        stripped = sentence
    return _trim_phrase(stripped, max_words=max_words)


def _deduplicate_view(view_text: str, driver_phrase: Optional[str]) -> str:
    """
    Remove sentences from view_text that overlap significantly with driver_phrase
    (>40% of driver phrase words present in the sentence).
    Falls back to the full original view_text if the filtered result is too short
    (<12 words), to prevent over-pruning of meaningful content.
    """
    if not driver_phrase or not view_text:
        return view_text
    driver_words = set(re.sub(r"[^\w\s]", "", driver_phrase.lower()).split())
    if not driver_words:
        return view_text
    sentences = re.split(r"(?<=[.!?])\s+", view_text.strip())
    filtered = [
        s for s in sentences
        if len(driver_words & set(re.sub(r"[^\w\s]", "", s.lower()).split())) / len(driver_words) < 0.4
    ]
    result = " ".join(filtered).strip() if filtered else sentences[0]
    # If too short after filtering, fall back to original to preserve strong content
    if len(result.split()) < 12:
        return view_text
    return result


_FILLER_OPENER_RE = re.compile(
    r"^(Overall,?\s*|Broadly,?\s*|In summary,?\s*|It is worth noting that\s*|"
    r"Notably,?\s*|It should be noted that\s*|Importantly,?\s*|So,?\s+)",
    re.IGNORECASE,
)

# Verb patterns used to split a sentence at its predicate for focus-phrase extraction
_FOCUS_VERB_RE = re.compile(
    r"\b(is|are|was|were|has|have|had|will|would|can|could|may|might|does|did"
    r"|suggest|suggests|indicate|indicates|lag|lags|close|closes|support|supports"
    r"|create|creates|reflect|reflects|drive|drives|limit|limits|remain|remains"
    r"|show|shows|point|points|signal|signals)\b",
    re.IGNORECASE,
)


# Words that signal a low-quality extraction — structural filler, not semantic content
_LOW_SIGNAL_WORDS: frozenset = frozenset({
    "strongest", "evidence", "driver", "accelerant", "upside", "downside",
    "main", "key", "primary", "core", "central", "question", "fact",
})

# Sentences that describe drivers/accelerants rather than uncertainties — excluded from key_uncertainty
_UNCERTAINTY_EXCLUDE_RE = re.compile(
    r"\b(upside driver|downside driver|upside risk|downside risk|main negative|main positive"
    r"|strongest evidence|evidence remains|accelerant|key driver|primary driver)\b",
    re.IGNORECASE,
)


def _is_low_quality(phrase: str) -> bool:
    """Return True if a phrase is too short or starts with low-signal structural words."""
    words = phrase.strip().split()
    if len(words) < 4:
        return True
    first = words[0].lower().rstrip(".,;:")
    return first in _LOW_SIGNAL_WORDS


def _extract_predicate_complement(sentence: str, max_words: int = 12) -> Optional[str]:
    """
    Extract the complement clause after the main verb.
    Strips leading "that/which" conjunctions.
    Returns None if predicate content is too short to be useful.
    """
    m = _FOCUS_VERB_RE.search(sentence)
    if not m:
        return None
    after_verb = sentence[m.end():].strip().lstrip(",").strip()
    # Strip subordinating "that" or "which"
    after_verb = re.sub(r"^(that|which)\s+", "", after_verb, flags=re.IGNORECASE).strip()
    if len(after_verb.split()) < 4:
        return None
    return _trim_phrase(after_verb, max_words=max_words)


def _extract_focus(text: str, max_words: int = 7) -> str:
    """
    Extract a short noun-phrase focus fragment from the first clean sentence of text.
    Primary: split at predicate verb → take subject noun phrase.
    Fallback: if subject is low-quality, take predicate complement instead.
    Final fallback: trim full sentence.
    """
    sentence = _first_sentence(_clean_rationale(text, max_sentences=1))
    m = _FOCUS_VERB_RE.search(sentence)
    if m and m.start() > 0:
        subject = sentence[: m.start()].strip().rstrip(".,;:")
        subject_words = subject.split()
        if 3 <= len(subject_words) <= max_words + 2 and not _is_low_quality(_to_noun_phrase(subject)):
            return _trim_phrase(_to_noun_phrase(subject), max_words=max_words)
        # Subject is low-quality — try predicate complement
        complement = _extract_predicate_complement(sentence, max_words=max_words)
        if complement and not _is_low_quality(complement):
            return complement
    return _trim_phrase(_to_noun_phrase(sentence), max_words=max_words)


def format_for_product(text: str, field_type: str) -> str:
    """
    Lightweight product-tone formatting pass.
      'phrase'   — noun phrase fragment ≤10 words, no trailing punctuation
      'view'     — max 2 sentences; strip filler openers; capitalise
      'sentence' — single sentence capped at 18 words; strip filler openers
    """
    if not text:
        return text
    text = _FILLER_OPENER_RE.sub("", text).strip()
    if not text:
        return text
    if field_type == "phrase":
        return _to_noun_phrase(text, max_words=10)
    if field_type == "view":
        # Enforce max 2 sentences
        sentences = re.split(r"(?<=[.!?])\s+", text.strip())
        text = " ".join(sentences[:2])
        return text[0].upper() + text[1:] if text else text
    if field_type == "sentence":
        # Take first sentence, cap at 18 words
        text = _first_sentence(text)
        words = text.split()
        if len(words) > 18:
            text = " ".join(words[:18]).rstrip(".,;:") + "."
        return text[0].upper() + text[1:] if text else text
    return text[0].upper() + text[1:]


def _infer_disagreement_type(
    spread: Optional[float],
    researcher_view: Optional[str],
    investor_view: Optional[str],
    key_uncertainty: Optional[str],
) -> str:
    """Infer the nature of disagreement between researcher and investor views."""
    if spread is not None and spread <= 8:
        return "low disagreement"
    combined = " ".join(filter(None, [researcher_view, investor_view, key_uncertainty])).lower()
    if any(w in combined for w in ("definition", "what counts", "what qualifies", "criteria", "defined as")):
        return "definition"
    if any(w in combined for w in ("benchmark", "metric", "measure", "measurement", "threshold")):
        return "measurement"
    if any(w in combined for w in ("adopt", "adoption", "enterprise", "deploy", "deployment", "organizational", "capability")):
        return "capability vs adoption"
    # timing is the default — applies to most macro/product questions
    return "timing"


def build_synthesis(summary: Dict[str, Any], runs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Derive user-facing synthesis fields from existing run data and summary statistics.
    No additional LLM calls — last ok run per profile wins (post-critique rationale).

    Three-phase pipeline:
      1. Extract: pull clean rationale text per profile
      2. Shape:   derive stats-driven fields (headline, net_effect, why_disagree)
      3. Format:  product formatting layer — remove redundancy, enforce tone, trim verbosity
    """
    overall = summary.get("overall", {})
    profile_summary = summary.get("profile_summary", {})

    # Collect the final rationale per profile (last ok run wins)
    profile_rationales: Dict[str, str] = {}
    for run in runs:
        if run.get("status") == "ok" and "parsed" in run:
            profile = run.get("profile", "")
            rationale = (run["parsed"].get("rationale") or "").strip()
            if rationale:
                profile_rationales[profile] = rationale

    researcher_p = profile_summary.get("researcher", {}).get("avg_probability")
    investor_p = profile_summary.get("investor", {}).get("avg_probability")
    weighted_baseline = overall.get("weighted_ai_baseline_probability")
    disagreement_score = overall.get("disagreement_score")
    highest = overall.get("highest_profile", "researcher")
    lowest = overall.get("lowest_profile", "investor")

    raw_researcher = profile_rationales.get("researcher", "")
    raw_investor = profile_rationales.get("investor", "")
    raw_base = profile_rationales.get("base", "")

    # ── Phase 0: Sanitize — strip first-person before any extraction ──────────
    _src_researcher = _strip_first_person(raw_researcher) if raw_researcher else ""
    _src_investor   = _strip_first_person(raw_investor)   if raw_investor   else ""
    _src_base       = _strip_first_person(raw_base)       if raw_base       else ""

    # ── Phase 1: Extract ──────────────────────────────────────────────────────

    researcher_view = _clean_rationale(_src_researcher, max_sentences=2) if _src_researcher else None
    investor_view   = _clean_rationale(_src_investor,   max_sentences=2) if _src_investor   else None

    # implication: last conclusion sentence from base (compressed to 1 sentence later)
    implication = (
        _best_implication_sentence(_src_base)
        if _src_base
        else _best_implication_sentence(_src_researcher or _src_investor)
        if (_src_researcher or _src_investor)
        else None
    )

    # primary_driver / main_constraint: verb-split extraction from sanitized source
    primary_driver = _extract_focus(_src_researcher, max_words=10) if _src_researcher else None
    main_constraint = _extract_focus(_src_investor, max_words=10) if _src_investor else None

    # key_uncertainty: best complete uncertainty sentence from sanitized source
    _uncertainty_source = _src_base or _src_researcher or _src_investor
    key_uncertainty = _best_uncertainty_sentence(_uncertainty_source) if _uncertainty_source else None

    # ── Phase 2: Shape ────────────────────────────────────────────────────────

    # why_disagree: causal narrative + spread number preserved
    if researcher_p is not None and investor_p is not None:
        spread = round(abs(researcher_p - investor_p), 1)
        if spread <= 8:
            spread_label = f"narrow {spread}-point"
        elif spread <= 20:
            spread_label = f"moderate {spread}-point"
        else:
            spread_label = f"material {spread}-point"

        # Use the first clean sentence from each profile, trimmed to ~14 words.
        # This preserves more semantic content than a short verb-split fragment,
        # and guarantees each side is drawn from its own distinct rationale.
        _r_sent = _first_sentence(_clean_rationale(_src_researcher, max_sentences=1)) if _src_researcher else ""
        _i_sent = _first_sentence(_clean_rationale(_src_investor, max_sentences=1)) if _src_investor else ""
        high_focus = _trim_phrase(_r_sent, max_words=14) if _r_sent else f"{highest} momentum"
        low_focus = _trim_phrase(_i_sent, max_words=14) if _i_sent else f"{lowest} friction"

        why_disagree = (
            f"Researchers focus on {high_focus.lower().rstrip('.,;:')}, "
            f"while investors highlight {low_focus.lower().rstrip('.,;:')} — "
            f"a {spread_label} difference."
        )
    else:
        why_disagree = None

    # signal_headline: "[Stance] at [X]% with [consensus]"
    if weighted_baseline is not None:
        if weighted_baseline >= 75:
            stance = "Likely"
        elif weighted_baseline >= 60:
            stance = "Probable"
        elif weighted_baseline >= 40:
            stance = "Near-even"
        else:
            stance = "Unlikely"
        if disagreement_score is None or disagreement_score <= 10:
            consensus_label = "tight consensus"
        elif disagreement_score <= 20:
            consensus_label = "moderate disagreement"
        else:
            consensus_label = "wide disagreement"
        signal_headline = f"{stance} at {round(weighted_baseline)}% with {consensus_label}"
    else:
        signal_headline = None

    # net_effect: 3-tier directional signal + disagreement tier
    if weighted_baseline is not None:
        if weighted_baseline >= 60:
            direction = "slightly bullish"
        elif weighted_baseline >= 45:
            direction = "near-even"
        else:
            direction = "skewed cautious"

        if disagreement_score is None or disagreement_score <= 10:
            net_effect = f"Signal is {direction} with tight consensus."
        elif disagreement_score <= 20:
            net_effect = f"Signal is {direction} with moderate disagreement around timing."
        else:
            net_effect = f"Signal is {direction} with material divergence across models."
    else:
        net_effect = None

    # disagreement_type: nature of the researcher/investor tension
    _spread_for_type = round(abs(researcher_p - investor_p), 1) if (researcher_p is not None and investor_p is not None) else None
    disagreement_type = _infer_disagreement_type(
        _spread_for_type, researcher_view, investor_view, key_uncertainty
    )

    # ── Phase 3: Product formatting layer ────────────────────────────────────

    # Remove first-sentence overlap between driver phrases and view paragraphs.
    # _deduplicate_view guarantees at least one sentence is always retained.
    if researcher_view:
        researcher_view = format_for_product(_deduplicate_view(researcher_view, primary_driver), "view")
    if investor_view:
        investor_view = format_for_product(_deduplicate_view(investor_view, main_constraint), "view")
    if primary_driver:
        primary_driver = format_for_product(primary_driver, "phrase")
    if main_constraint:
        main_constraint = format_for_product(main_constraint, "phrase")
    if implication:
        implication = format_for_product(implication, "sentence")
    # If implication is still low-quality after extraction, replace with stats-based fallback
    if not implication or _is_low_quality(implication):
        if weighted_baseline is not None:
            if weighted_baseline >= 75:
                implication = "Signal is well above threshold — execution risk is the primary variable, not direction."
            elif weighted_baseline >= 55:
                implication = "Signal leans positive — outcome depends on resolving key timing and execution uncertainties."
            elif weighted_baseline >= 40:
                implication = "Signal is near-even — meaningful headwinds and tailwinds remain in balance."
            else:
                implication = "Signal leans cautious — meaningful obstacles would need to resolve for the outcome to occur."
    if key_uncertainty:
        key_uncertainty = format_for_product(key_uncertainty, "sentence")

    return {
        "researcher_view": researcher_view,
        "investor_view": investor_view,
        "key_uncertainty": key_uncertainty,
        "why_disagree": why_disagree,
        "signal_headline": signal_headline,
        "implication": implication,
        "primary_driver": primary_driver,
        "main_constraint": main_constraint,
        "net_effect": net_effect,
        "disagreement_type": disagreement_type,
    }


def load_gold_examples() -> List[Dict[str, Any]]:
    """Load gold synthesis examples from gold_examples.json (sibling of this file)."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gold_examples.json")
    with open(path, "r") as f:
        return json.load(f)


# Phrases that must never appear in key_uncertainty (they describe drivers, not uncertainties)
_REWRITE_BANNED_PHRASES: tuple = (
    "strongest upside driver",
    "strongest downside driver",
    "most likely accelerant",
)

# Pattern that matches punctuation-only strings (". .", "—", etc.)
_PUNCT_ONLY_RE = re.compile(r'^[\s.,;:!?–—\-"\'()\[\]]*$')


def _validate_rewritten_field(key: str, value: Optional[str], raw_synthesis: Dict[str, Any]) -> bool:
    """
    Return True if a rewritten field passes quality validation.
    Rules:
      - Must not be None, empty, or whitespace-only
      - Must not be punctuation-only (e.g. ". .")
      - key_uncertainty: must not contain banned driver phrases
      - implication: must not duplicate key_uncertainty verbatim
      - primary_driver / main_constraint: must have at least 3 meaningful words (len > 2)
    """
    if value is None:
        return False
    text = str(value).strip()
    if not text:
        return False
    if _PUNCT_ONLY_RE.fullmatch(text):
        return False
    if key == "key_uncertainty":
        lower = text.lower()
        if any(phrase in lower for phrase in _REWRITE_BANNED_PHRASES):
            return False
    if key == "implication":
        raw_ku = str(raw_synthesis.get("key_uncertainty") or "").strip()
        if raw_ku and text == raw_ku:
            return False
        rewritten_ku = str(raw_synthesis.get("key_uncertainty") or "").strip()
        if rewritten_ku and text == rewritten_ku:
            return False
    if key in ("primary_driver", "main_constraint"):
        meaningful = [w for w in text.split() if len(w) > 2]
        if len(meaningful) < 3:
            return False
    if key == "disagreement_type":
        valid = {"timing", "capability vs adoption", "measurement", "definition", "low disagreement"}
        if text not in valid:
            return False
    return True


_DOUBLE_SPACE_RE = re.compile(r"  +")


def _normalize_synthesis(d: Dict[str, Any]) -> Dict[str, Any]:
    """
    Final normalization pass over a synthesis dict:
    - Trim leading/trailing whitespace
    - Collapse double spaces
    - Sentence-case each string field (first char uppercase)
    - Replace empty/whitespace-only strings with None
    Non-string values (e.g. disagreement_type is always str, but guard anyway) pass through.
    """
    out: Dict[str, Any] = {}
    for key, val in d.items():
        if not isinstance(val, str):
            out[key] = val
            continue
        normalized = _DOUBLE_SPACE_RE.sub(" ", val.strip())
        if not normalized:
            out[key] = None
            continue
        # Sentence-case: uppercase first character, preserve the rest
        out[key] = normalized[0].upper() + normalized[1:]
    return out


_HEADLINE_PROB_RE = re.compile(r"at\s+(\d+(?:\.\d+)?)%", re.IGNORECASE)


def _derive_synthesis_profile(synthesis: Dict[str, Any]) -> Dict[str, str]:
    """
    Infer probability_regime and disagreement_level from the current synthesis
    so example selection needs no extra plumbing.
    """
    headline = synthesis.get("signal_headline") or ""
    m = _HEADLINE_PROB_RE.search(headline)
    p = float(m.group(1)) if m else None

    if p is None:
        regime = "unknown"
    elif p >= 75:
        regime = "bullish"
    elif p >= 60:
        regime = "near_even_to_slightly_bullish"
    elif p >= 40:
        regime = "near_even"
    else:
        regime = "bearish"

    h_lower = headline.lower()
    if "tight consensus" in h_lower:
        level = "low"
    elif "wide disagreement" in h_lower:
        level = "high"
    else:
        level = "moderate"  # covers "moderate disagreement" and unknown

    return {
        "probability_regime": regime,
        "disagreement_level": level,
        "disagreement_type": synthesis.get("disagreement_type") or "timing",
    }


def _score_example(
    example: Dict[str, Any],
    profile: Dict[str, str],
    question_domain: Optional[str],
) -> int:
    """Score a gold example against the derived synthesis profile."""
    score = 0
    tp = example.get("target_profile", {})
    ex_synth = example.get("synthesis", {})
    if question_domain and example.get("category", "").lower() == question_domain.lower():
        score += 3
    if tp.get("probability_regime") == profile.get("probability_regime"):
        score += 2
    if ex_synth.get("disagreement_type") == profile.get("disagreement_type"):
        score += 2
    if tp.get("disagreement_level") == profile.get("disagreement_level"):
        score += 1
    return score


def _select_style_examples(
    synthesis: Dict[str, Any],
    examples: List[Dict[str, Any]],
    question_domain: Optional[str] = None,
    n: int = 2,
) -> List[Dict[str, Any]]:
    """
    Return up to n gold examples ranked by similarity to the current synthesis profile.
    Ties are broken by list order (stable sort).
    """
    if not examples:
        return []
    profile = _derive_synthesis_profile(synthesis)
    scored = sorted(
        examples,
        key=lambda ex: _score_example(ex, profile, question_domain),
        reverse=True,
    )
    return scored[:n]


def rewrite_synthesis(
    synthesis: Dict[str, Any],
    examples: List[Dict[str, Any]],
    question_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Use the OpenAI API to rewrite synthesis fields to match product-quality style.
    Gold examples are selected by similarity (category, probability regime, disagreement type)
    and used as annotated style references — not copied verbatim.

    Field-by-field validation: rewritten fields that fail quality checks fall back
    to the corresponding raw field. Only fields that pass are accepted.
    A final normalization pass cleans whitespace and casing.
    """
    if not OPENAI_API_KEY:
        print("[REWRITE] No OPENAI_API_KEY — skipping rewrite, using raw synthesis.")
        return synthesis

    question_domain = (question_context or {}).get("domain")
    question_text = (question_context or {}).get("text", "")
    question_id = (question_context or {}).get("id", "")

    style_examples = _select_style_examples(synthesis, examples, question_domain, n=2)
    derived_profile = _derive_synthesis_profile(synthesis)
    print(
        f"[REWRITE] Selected style examples: "
        + ", ".join(ex.get("id", "?") for ex in style_examples)
        + f" | derived profile: {derived_profile}"
    )

    style_examples_text = json.dumps(
        [
            {
                "id": ex.get("id"),
                "question": ex.get("question"),
                "category": ex.get("category"),
                "target_profile": ex.get("target_profile"),
                "synthesis": ex.get("synthesis"),
            }
            for ex in style_examples
        ],
        indent=2,
    )
    synthesis_text = json.dumps(synthesis, indent=2)

    prompt = (
        "You are rewriting structured forecast synthesis output to match product-quality style.\n\n"
        "## QUESTION BEING SYNTHESIZED\n"
        f"ID: {question_id}\n"
        f"Question: {question_text}\n\n"
        "## CURRENT SYNTHESIS PROFILE\n"
        f"{json.dumps(derived_profile, indent=2)}\n\n"
        "## STYLE REFERENCE EXAMPLES\n"
        "These examples are selected by similarity to the current synthesis (category, "
        "probability regime, disagreement type). Use them for style supervision only — "
        "do NOT copy any sentence verbatim.\n\n"
        "How to read the metadata:\n"
        "- target_profile.probability_regime: tone calibration (bullish → confident affirmation; "
        "near_even → balanced hedging; bearish → cautious framing)\n"
        "- target_profile.disagreement_level: how much tension to show between researcher/investor views "
        "(low → converging; moderate → clear but not sharp; high → material tension)\n"
        "- target_profile.headline_style: exact format to follow for signal_headline\n"
        "- synthesis.disagreement_type: governs why_disagree framing — "
        "timing (when vs whether), definition (what counts), measurement (threshold/metric), "
        "capability vs adoption (can do vs will do)\n\n"
        f"{style_examples_text}\n\n"
        "## INPUT SYNTHESIS TO REWRITE\n"
        f"{synthesis_text}\n\n"
        "## STYLE RULES\n"
        "- Keep exactly the same meaning and facts — do not add or remove information\n"
        "- Match the tone, sentence length, and phrasing register of the style examples\n"
        "- Remove any model-like, first-person, or analyst-note phrasing\n"
        "- Do not change any numeric probability values\n"
        "- If a field is weak or fragmentary, reconstruct it from context in other fields\n"
        "- Use the current synthesis's disagreement_type to frame the why_disagree sentence\n\n"
        "## FIELD-LEVEL CONSTRAINTS\n"
        "Each field must satisfy its own rules, or it will be discarded:\n"
        "- signal_headline: ≤10 words; must follow '[Stance] at [X]% with [descriptor]' exactly;\n"
        "  stance ∈ {Unlikely, Near-even, Probable, Likely};\n"
        "  descriptor ∈ {tight consensus, moderate disagreement, wide disagreement}\n"
        "- primary_driver: noun phrase only, 5–8 words; no finite verbs; no full sentence\n"
        "- main_constraint: noun phrase only, 5–8 words; no finite verbs; no full sentence\n"
        "- key_uncertainty: exactly 1 complete sentence; must describe what is genuinely uncertain;\n"
        "  must NOT contain 'upside driver', 'downside driver', or 'accelerant'\n"
        "- researcher_view: 1–2 sentences; no first-person language; ends with a complete sentence\n"
        "- investor_view: 1–2 sentences; no first-person language; ends with a complete sentence\n"
        "- why_disagree: exactly 1 sentence; use template "
        "'Researchers focus on X, while investors focus on Y — a [N]-point difference.'\n"
        "  Let the disagreement_type guide what X and Y emphasize\n"
        "- implication: exactly 1 sentence; no probability numbers or percentages;\n"
        "  must not duplicate key_uncertainty\n"
        "- net_effect: exactly 1 sentence; must start with 'Signal is';\n"
        "  must not duplicate signal_headline\n"
        "- disagreement_type: must be exactly one of: timing / capability vs adoption / "
        "measurement / definition / low disagreement\n\n"
        "## HARD RULES\n"
        "- No field may be empty, null, or contain only punctuation\n"
        "- No two fields may have identical content\n"
        "- primary_driver and main_constraint must each have at least 3 meaningful words\n\n"
        "OUTPUT: Return valid JSON with exactly the same keys as the input. "
        "Return ONLY the JSON object — no explanation, no markdown, no code fences."
    )

    url = "https://api.openai.com/v1/responses"
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": OPENAI_MODEL,
        "input": [{"role": "user", "content": prompt}],
    }

    try:
        resp = _openai_post(url, headers, payload)
        resp.raise_for_status()
        output_text = _extract_openai_text(resp.json())
        # Strip markdown code fences if present
        output_text = re.sub(r"^```(?:json)?\s*", "", output_text.strip(), flags=re.IGNORECASE)
        output_text = re.sub(r"\s*```$", "", output_text.strip())
        rewritten = json.loads(output_text)
    except Exception as exc:
        print(f"[REWRITE] Failed ({exc}) — falling back to raw synthesis.")
        return synthesis

    # Schema check — keys must match exactly
    if set(rewritten.keys()) != set(synthesis.keys()):
        print(f"[REWRITE] Schema mismatch — using raw synthesis.")
        return synthesis

    # Field-by-field validation: accept rewritten value only if it passes quality gate
    merged: Dict[str, Any] = {}
    accepted = rejected = 0
    for key in synthesis:
        rewritten_val = rewritten.get(key)
        if _validate_rewritten_field(key, rewritten_val, synthesis):
            merged[key] = rewritten_val
            accepted += 1
        else:
            merged[key] = synthesis[key]
            rejected += 1
            if rewritten_val != synthesis[key]:
                print(f"[REWRITE] Field '{key}' failed validation — keeping raw value.")

    print(f"[REWRITE] Done: {accepted} fields rewritten, {rejected} kept raw.")
    return _normalize_synthesis(merged)


def summarize_results(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_provider: Dict[str, List[int]] = {}
    by_profile: Dict[str, List[int]] = {}

    for row in rows:
        if row.get("status") != "ok" or "parsed" not in row:
            continue
        by_provider.setdefault(row["provider"], []).append(row["parsed"]["probability"])
        by_profile.setdefault(row["profile"], []).append(row["parsed"]["probability"])

    provider_summary = {
        provider: {
            "n": len(vals),
            "avg_probability": round(statistics.mean(vals), 1),
            "stdev_probability": round(statistics.pstdev(vals), 1) if len(vals) > 1 else 0.0,
        }
        for provider, vals in by_provider.items()
    }

    profile_summary = {
        profile: {
            "n": len(vals),
            "avg_probability": round(statistics.mean(vals), 1),
            "stdev_probability": round(statistics.pstdev(vals), 1) if len(vals) > 1 else 0.0,
        }
        for profile, vals in by_profile.items()
    }

    all_probs = [row["parsed"]["probability"] for row in rows if row.get("status") == "ok" and "parsed" in row]

    conf_pairs = [
        (row["parsed"]["probability"], row["parsed"]["confidence"])
        for row in rows
        if row.get("status") == "ok" and "parsed" in row
        and row["parsed"].get("confidence") is not None
    ]
    if conf_pairs:
        total_conf = sum(c for _, c in conf_pairs)
        conf_weighted = round(sum(p * c for p, c in conf_pairs) / total_conf, 1) if total_conf else None
    else:
        conf_weighted = None

    profile_avgs = {
        profile: round(statistics.mean(vals), 1)
        for profile, vals in by_profile.items()
    }
    highest_profile = max(profile_avgs, key=lambda p: profile_avgs[p]) if profile_avgs else None
    lowest_profile = min(profile_avgs, key=lambda p: profile_avgs[p]) if profile_avgs else None

    overall = {
        "n": len(all_probs),
        "ai_baseline_probability": round(statistics.mean(all_probs), 1) if all_probs else None,
        "weighted_ai_baseline_probability": _weighted_profile_avg(profile_avgs, PROFILE_WEIGHTS),
        "confidence_weighted_baseline": conf_weighted,
        "ai_spread_stdev": round(statistics.pstdev(all_probs), 1) if len(all_probs) > 1 else 0.0,
        "min_probability": min(all_probs) if all_probs else None,
        "max_probability": max(all_probs) if all_probs else None,
        "disagreement_score": (max(all_probs) - min(all_probs)) if all_probs else None,
        "highest_profile": highest_profile,
        "lowest_profile": lowest_profile,
    }

    return {
        "prompt_version": PROMPT_VERSION,
        "provider_summary": provider_summary,
        "profile_summary": profile_summary,
        "overall": overall,
    }


# ---------- Supabase helpers ----------

def insert_raw_forecast(
    question: Dict[str, str],
    provider: str,
    model: str,
    profile_name: str,
    run_idx: int,
    parsed: Dict[str, Any],
    prompt_version: str = PROMPT_VERSION,
) -> None:
    if not supabase:
        return

    base_payload = {
        "question_id": question["id"],
        "question_text": question["text"],
        "provider": provider,
        "model": model,
        "profile": profile_name,
        "run_number": run_idx,
        "probability": parsed["probability"],
        "confidence": parsed["confidence"],
        "rationale": parsed["rationale"],
        "assumptions": parsed["assumptions"],
    }
    try:
        supabase.table("ai_forecasts").insert({**base_payload, "prompt_version": prompt_version}).execute()
    except Exception:
        supabase.table("ai_forecasts").insert(base_payload).execute()

def upsert_summary(question: Dict[str, str], summary: Dict[str, Any]) -> None:
    if not supabase:
        return

    payload = {
        "question_id": question["id"],
        "question_text": question["text"],
        "ai_baseline_probability": summary["overall"]["ai_baseline_probability"],
        "summary": summary,
        "updated_at": now_iso(),
        "prompt_version": summary.get("prompt_version"),
    }
    supabase.table("ai_forecast_summaries").upsert(
        payload,
        on_conflict="question_id",
        ignore_duplicates=False,
    ).execute()


def fetch_questions() -> List[Dict[str, Any]]:
    """
    Fetch active questions from public.signals and map them to the pipeline question shape.
    Falls back to an empty list if Supabase is unavailable or returns no rows.
    """
    if not supabase:
        print("[QUESTIONS] Supabase not available — no questions to run.")
        return []

    result = (
        supabase.table("signals")
        .select("id, question, category, resolution_date")
        .eq("status", "active")
        .execute()
    )

    rows = result.data or []
    questions = [
        {
            "id": row["id"],
            "text": row["question"],
            "domain": row.get("category") or "",
            "deadline": row.get("resolution_date") or "",
            "resolution_criteria": "",
        }
        for row in rows
        if row.get("id") and row.get("question")
    ]
    return questions


def upsert_signal(question: Dict[str, str], summary: Dict[str, Any]) -> None:
    if not supabase:
        return

    overall = summary.get("overall", {})
    score = overall.get("disagreement_score")
    ai_consensus = overall.get("weighted_ai_baseline_probability") or overall.get("ai_baseline_probability")

    if score is None:
        signal_strength = None
    elif score <= 5:
        signal_strength = "low"
    elif score <= 15:
        signal_strength = "moderate"
    else:
        signal_strength = "high"

    payload = {
        "id":              question["id"],
        "question":        question["text"],
        "category":        question.get("domain"),
        "status":          "active",
        "resolution_date": question.get("deadline"),
        "ai_consensus":    ai_consensus,
        "combined_signal": ai_consensus,
        "divergence":      score,
        "signal_strength": signal_strength,
    }
    supabase.table("signals").upsert(
        payload,
        on_conflict="id",
        ignore_duplicates=False,
    ).execute()


# ---------- Provider Calls ----------

def _openai_post(url: str, headers: Dict[str, str], payload: Dict[str, Any]) -> requests.Response:
    """POST to OpenAI with up to 3 retries on 429 or 5xx. Exponential backoff: 1s, 2s, 4s."""
    max_attempts = 3
    for attempt in range(1, max_attempts + 1):
        resp = requests.post(url, headers=headers, json=payload, timeout=90)
        if resp.status_code not in (429, 500, 502, 503, 504) or attempt == max_attempts:
            return resp
        wait = 2 ** (attempt - 1)
        print(f"  [RETRY] OpenAI HTTP {resp.status_code} — attempt {attempt}/{max_attempts}, waiting {wait}s")
        time.sleep(wait)
    return resp  # unreachable but satisfies type checker

def call_openai(question: Dict[str, str], profile_name: str, profile_instruction: str, evidence_brief: str = "") -> Dict[str, Any]:
    if not OPENAI_API_KEY:
        raise RuntimeError("Missing OPENAI_API_KEY")

    url = "https://api.openai.com/v1/responses"
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": OPENAI_MODEL,
        "input": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": build_initial_user_prompt(question, profile_name, profile_instruction, evidence_brief),
            },
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "forecast_response",
                "schema": FORECAST_JSON_SCHEMA,
                "strict": True,
            }
        },
    }

    print(f"  [openai] calling {OPENAI_MODEL} profile={profile_name}")
    resp = _openai_post(url, headers, payload)
    resp.raise_for_status()
    data = resp.json()

    output_text = _extract_openai_text(data)
    parsed = validate_forecast(json.loads(output_text))
    print(f"  [openai] extracted text OK — p={parsed.probability} conf={parsed.confidence}")
    return {"raw": data, "parsed": parsed.model_dump(), "model_name": OPENAI_MODEL, "initial_raw_text": output_text}


def call_anthropic(question: Dict[str, str], profile_name: str, profile_instruction: str, evidence_brief: str = "") -> Dict[str, Any]:
    if not ANTHROPIC_API_KEY:
        raise RuntimeError("Missing ANTHROPIC_API_KEY")

    url = "https://api.anthropic.com/v1/messages"
    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    payload = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 500,
        "system": SYSTEM_PROMPT,
        "messages": [
            {
                "role": "user",
                "content": build_initial_user_prompt(question, profile_name, profile_instruction, evidence_brief),
            }
        ],
    }

    resp = requests.post(url, headers=headers, json=payload, timeout=90)
    resp.raise_for_status()
    data = resp.json()

    parts = data.get("content", [])
    text_chunks = [p.get("text", "") for p in parts if p.get("type") == "text"]
    text = "\n".join(text_chunks).strip()
    parsed_json = json.loads(extract_first_json_object(text))
    parsed = validate_forecast(parsed_json)

    return {"raw": data, "parsed": parsed.model_dump(), "initial_raw_text": text, "model_name": ANTHROPIC_MODEL}


def run_single(
    provider: str,
    question: Dict[str, str],
    profile_name: str,
    profile_instruction: str,
    evidence_brief: str = "",
) -> Dict[str, Any]:
    if provider == "openai":
        return call_openai(question, profile_name, profile_instruction, evidence_brief)
    if provider == "anthropic":
        return call_anthropic(question, profile_name, profile_instruction, evidence_brief)
    raise ValueError(f"Unknown provider: {provider}")


def _call_raw_text(provider: str, system: str, user: str) -> str:
    """Make a provider call that returns plain text (used for critique)."""
    if provider == "openai":
        if not OPENAI_API_KEY:
            raise RuntimeError("Missing OPENAI_API_KEY")
        resp = _openai_post(
            "https://api.openai.com/v1/responses",
            {"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
            {"model": OPENAI_MODEL, "input": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
        )
        resp.raise_for_status()
        return _extract_openai_text(resp.json())

    if provider == "anthropic":
        if not ANTHROPIC_API_KEY:
            raise RuntimeError("Missing ANTHROPIC_API_KEY")
        resp = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": ANTHROPIC_MODEL,
                "max_tokens": 600,
                "system": system,
                "messages": [{"role": "user", "content": user}],
            },
            timeout=90,
        )
        resp.raise_for_status()
        parts = resp.json().get("content", [])
        return "\n".join(p.get("text", "") for p in parts if p.get("type") == "text").strip()

    raise ValueError(f"Unknown provider: {provider}")


def _call_forecast_with_prompt(provider: str, user_prompt: str) -> Dict[str, Any]:
    """
    Call provider with a pre-built user prompt and return parsed forecast + raw text.
    Used for the revision step where the prompt is already fully constructed.
    """
    if provider == "openai":
        if not OPENAI_API_KEY:
            raise RuntimeError("Missing OPENAI_API_KEY")
        resp = _openai_post(
            "https://api.openai.com/v1/responses",
            {"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
            {
                "model": OPENAI_MODEL,
                "input": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                "text": {"format": {"type": "json_schema", "name": "forecast_response", "schema": FORECAST_JSON_SCHEMA, "strict": True}},
            },
        )
        resp.raise_for_status()
        output_text = _extract_openai_text(resp.json())
        parsed = validate_forecast(json.loads(output_text))
        return {"parsed": parsed.model_dump(), "raw_text": output_text}

    if provider == "anthropic":
        if not ANTHROPIC_API_KEY:
            raise RuntimeError("Missing ANTHROPIC_API_KEY")
        resp = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": ANTHROPIC_MODEL,
                "max_tokens": 600,
                "system": SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": user_prompt}],
            },
            timeout=90,
        )
        resp.raise_for_status()
        parts = resp.json().get("content", [])
        text = "\n".join(p.get("text", "") for p in parts if p.get("type") == "text").strip()
        parsed = validate_forecast(json.loads(extract_first_json_object(text)))
        return {"parsed": parsed.model_dump(), "raw_text": text}

    raise ValueError(f"Unknown provider: {provider}")


def run_with_critique(
    provider: str,
    question: Dict[str, str],
    profile_name: str,
    profile_instruction: str,
    evidence_brief: str = "",
) -> Dict[str, Any]:
    """
    Run initial forecast → critique → revised forecast.
    Falls back to initial if critique or revision fails.
    Returns: parsed, initial_parsed, initial_raw_text, revision_raw_text, critique_text, stage_used, model_name.
    """
    initial_result = run_single(provider, question, profile_name, profile_instruction, evidence_brief)
    initial_parsed: Dict[str, Any] = initial_result["parsed"]
    initial_raw_text: Optional[str] = initial_result.get("initial_raw_text")
    model_name: str = initial_result["model_name"]

    critique_text: Optional[str] = None
    revision_raw_text: Optional[str] = None
    final_parsed = initial_parsed
    stage_used = "initial_fallback"

    try:
        critique_text = _call_raw_text(
            provider,
            system="You are a critical reviewer of probabilistic forecasts.",
            user=build_critique_prompt(question, initial_parsed, evidence_brief),
        )

        revision_prompt = build_revision_prompt(
            question, profile_name, profile_instruction, initial_parsed, critique_text, evidence_brief
        )
        revision_result = _call_forecast_with_prompt(provider, revision_prompt)
        final_parsed = revision_result["parsed"]
        revision_raw_text = revision_result.get("raw_text")
        stage_used = "revised"

    except Exception as e:
        print(f"  [WARN] Critique/revision failed ({e}), using initial forecast")

    return {
        "parsed": final_parsed,
        "initial_parsed": initial_parsed,
        "initial_raw_text": initial_raw_text,
        "revision_raw_text": revision_raw_text,
        "critique_text": critique_text,
        "stage_used": stage_used,
        "model_name": model_name,
    }


# ---------- Main Runner ----------

def main() -> None:
    all_results: List[Dict[str, Any]] = []

    try:
        gold_examples = load_gold_examples()
        print(f"[GOLD] Loaded {len(gold_examples)} example(s) from gold_examples.json")
    except Exception as exc:
        print(f"[GOLD] Could not load gold_examples.json ({exc}) — rewrite step will be skipped.")
        gold_examples = []

    questions = fetch_questions()
    print(f"[QUESTIONS] Running {len(questions)} question(s): {[q['id'] for q in questions]}")
    if not questions:
        print("[QUESTIONS] Nothing to run — exiting.")
        return

    for question in questions:
        question_runs: List[Dict[str, Any]] = []

        evidence_provider = PROVIDERS[0]
        print(f"[EVIDENCE] Generating brief for {question['id']} via {evidence_provider}...")
        evidence_brief = generate_evidence_brief(evidence_provider, question)
        if evidence_brief:
            print(f"[EVIDENCE] Brief generated ({len(evidence_brief)} chars)")

        for profile_name, profile_data in PROFILES.items():
            profile_instruction = profile_data["prompt"]
            for provider in PROVIDERS:
                for run_idx in range(1, RUNS_PER_PROVIDER + 1):
                    record: Dict[str, Any] = {
                        "timestamp_utc": now_iso(),
                        "question_id": question["id"],
                        "question_text": question["text"],
                        "provider": provider,
                        "profile": profile_name,
                        "run_number": run_idx,
                        "prompt_version": PROMPT_VERSION,
                        "status": "ok",
                    }

                    try:
                        result = run_with_critique(provider, question, profile_name, profile_instruction, evidence_brief)
                        record["parsed"] = result["parsed"]
                        record["initial_parsed"] = result["initial_parsed"]
                        if evidence_brief:
                            record["evidence_brief"] = evidence_brief
                        record["model_name"] = result["model_name"]
                        record["stage_used"] = result["stage_used"]
                        record["critique_text"] = result["critique_text"]
                        if result.get("initial_raw_text"):
                            record["initial_raw_text"] = result["initial_raw_text"]
                        if result.get("revision_raw_text"):
                            record["revision_raw_text"] = result["revision_raw_text"]

                        insert_raw_forecast(
                            question=question,
                            provider=provider,
                            model=result["model_name"],
                            profile_name=profile_name,
                            run_idx=run_idx,
                            parsed=result["parsed"],
                        )

                        print(
                            f"[OK] {question['id']} | {profile_name} | {provider} | run {run_idx} "
                            f"-> p={result['parsed']['probability']} ({result['stage_used']})"
                        )

                    except Exception as e:
                        record["status"] = "error"
                        record["error"] = str(e)
                        print(
                            f"[ERR] {question['id']} | {profile_name} | {provider} | run {run_idx} "
                            f"-> {type(e).__name__}: {e}"
                        )

                    question_runs.append(record)
                    all_results.append(record)
                    time.sleep(SLEEP_SECONDS)

            time.sleep(1.5)

        ok_runs = [r for r in question_runs if r.get("status") == "ok" and "parsed" in r]
        print(f"[SUMMARY] {question['id']}: {len(ok_runs)}/{len(question_runs)} runs succeeded")
        summary = summarize_results(question_runs)

        # Attach synthesis — must happen before write_json and upsert so it is persisted
        raw_synthesis = build_synthesis(summary, question_runs)
        rewritten = rewrite_synthesis(raw_synthesis, gold_examples, question_context=question) if gold_examples else raw_synthesis
        summary["synthesis"] = rewritten
        print("[SYNTHESIS]", question["id"], summary["synthesis"])

        write_json(
            os.path.join(OUTPUT_DIR, f"{question['id']}_runs.json"),
            question_runs,
        )
        write_json(
            os.path.join(OUTPUT_DIR, f"{question['id']}_summary.json"),
            summary,
        )

        try:
            upsert_summary(question, summary)
        except Exception as e:
            print(f"[WARN] Failed to upsert summary to Supabase for {question['id']}: {e}")

        try:
            upsert_signal(question, summary)
        except Exception as e:
            print(f"[WARN] Failed to upsert signal to Supabase for {question['id']}: {e}")

    write_json(os.path.join(OUTPUT_DIR, "all_runs.json"), all_results)

    overall_by_question: Dict[str, Any] = {}
    for question in questions:
        rows = [r for r in all_results if r["question_id"] == question["id"]]
        overall_by_question[question["id"]] = {
            "question_text": question["text"],
            "summary": summarize_results(rows),
        }

    write_json(os.path.join(OUTPUT_DIR, "overall_summary.json"), overall_by_question)
    print(f"\nDone. Wrote results to ./{OUTPUT_DIR}/")


if __name__ == "__main__":
    main()