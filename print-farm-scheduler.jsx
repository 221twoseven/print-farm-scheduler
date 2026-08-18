import React, { useState, useMemo, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Plus,
  Settings,
  X,
  Trash2,
  Check,
  Activity,
  Pencil,
  Inbox,
  Copy,
  Flag,
  Search,
  StickyNote,
  CheckCircle2,
} from "lucide-react";

/* =====================================================================
   PERSISTENCE SEAM — read before wiring SharePoint (Phase 2)

   Four lists back this app: Groups, Printers, Tasks, Settings.

   Ordering. Every record carries an integer `sortOrder`, matching the
   SortOrder column in the Phase 1 schema. Two rules keep it honest:
     1. On hydrate, rows arrive from Graph in arbitrary order — run them
        through `hydrate()` before they enter state.
     2. After that point array position is authoritative. Any structural
        change runs `reindex()`, which renumbers the affected scope
        0,1,2… and preserves object identity for untouched rows, so the
        save layer can diff by reference and only PATCH what moved.
     Scopes: groups = board, printers = their group, tasks = their printer
     (with STAGING as its own scope).

   Settings list. Single-row key/value store for board-wide preferences
   that have no other home. Two columns beyond Title:
     Title (built-in)  the key, e.g. stagingName
     Value             single line of text
   Keys: stagingName, printersPerRow, groupsPerRow. Numbers stored as
   text and parsed on read. See DEFAULT_APP_SETTINGS below.
   ===================================================================== */

/* ----------------------------- constants ------------------------------ */

/* Interaction accent. Focus rings, drag targets, the active state of a control
   — anything answering "what am I touching", never "what is this". Kept apart
   from the state colors so that a color on this board always means either an
   interaction or a state, and never an identity. */
const ACCENT = "#5B5FC7";

/* Group colors are still assigned and stored, but nothing renders them.

   They used to carry group identity on every card and chip. The board ended up
   with three color systems competing — group, printer state, task status — and
   a color that means three things means none of them; the printer state color
   in particular was unreadable until it changed in front of you. Group is the
   one of the three that a color was never needed for: a printer cannot move
   between groups, and the grouping is already obvious from the layout and the
   group's name.

   The values stay because they cost nothing, the Color column keeps round
   tripping, and reversing this needs no schema change — see
   docs/decisions.md. */
const GROUP_COLORS = [
  "#5B5FC7", // indigo
  "#038387", // teal
  "#CA5010", // orange
  "#0F6CBD", // blue
  "#C239B3", // magenta
  "#498205", // green
  "#D13438", // red
  "#69797E", // steel
];

const nextGroupColor = (groups) => {
  const used = new Set(groups.map((g) => g.color));
  return GROUP_COLORS.find((c) => !used.has(c)) || GROUP_COLORS[groups.length % GROUP_COLORS.length];
};

/* Printer tag fields. The `column` is the SharePoint column that supplies
   this field's dropdown options — see DEFAULT_CHOICES below. */
const PRINTER_FIELDS = [
  { key: "nozzleSize", label: "Nozzle size", column: "NozzleSize" },
  { key: "nozzleType", label: "Nozzle type", column: "NozzleType" },
  { key: "nozzleMaterial", label: "Nozzle material", column: "NozzleMaterial" },
  { key: "bedType", label: "Bed type", column: "BedType" },
  { key: "printMaterial", label: "Material", column: "PrintMaterial" },
];

/* ---------------------------------------------------------------------
   Editable-in-SharePoint dropdowns.

   These seven lists describe equipment and slicer settings. Nothing in the
   app branches on their values, so they can change without code changes:
   on sign-in, read the choice columns and replace this object wholesale.

     Printers list:  GET /sites/{site-id}/lists/Printers/columns
     Tasks list:     GET /sites/{site-id}/lists/Tasks/columns
     → each column returns { name, choice: { choices: [...] } }

   Map column name → key using PRINTER_FIELDS[].column plus PrintQuality
   and PrintStrength. If the call fails, keep these defaults — a stale
   dropdown is better than an empty one.

   The lists below MUST stay in step with the Choice column values in
   SharePoint until that wiring lands, and the defaults should keep
   matching afterwards so the app still works offline of a failed read.

   Not in here on purpose: Status, Priority, SliceStatus and printer
   Status. Those drive behaviour, so they stay in code.
   --------------------------------------------------------------------- */
const DEFAULT_CHOICES = {
  nozzleSize: ["0.2mm", "0.4mm", "0.6mm", "0.8mm", "1mm"],
  nozzleType: ["Standard", "High Flow"],
  nozzleMaterial: ["Standard", "Hardened", "Tungsten"],
  bedType: ["Smooth", "Textured"],
  printMaterial: ["ABS", "Other"],
  /* Tasks carry their own material column — a different list, so it needs
     its own key even though the wording now matches; see loadChoices. */
  taskPrintMaterial: ["ABS", "Other"],
  printQuality: ["Draft", "Medium", "High"],
  printStrength: ["Structural", "Standard", "Aesthetic"],
};

/* A row written before a choice was removed still holds the old value.
   Keep it in the dropdown so the field doesn't silently read as blank. */
const optionsFor = (list, current) => {
  const opts = list || [];
  return current && !opts.includes(current) ? [...opts, current] : opts;
};

/* What a printer's spec fields say, once the ones matching the shop default
   are dropped. An empty list means "standard setup" and the card can say so in
   three words instead of five values.

   "Default" is a code constant rather than a SharePoint read, deliberately:
   "standard setup" is a shop convention, not data, and reading it from the
   choice columns would mean the first value of each list silently became the
   standard. The cost is that editing a choice column so a default value no
   longer exists makes every printer read as an exception — visible immediately,
   and fixed by editing DEFAULT_PRINTER_FIELDS to match. */
const specExceptions = (settings) => {
  const defaults = DEFAULT_PRINTER_FIELDS;
  return PRINTER_FIELDS.filter(
    (f) => (settings.fields[f.key] || "") !== defaults[f.key]
  ).map((f) => {
    const value = settings.fields[f.key];
    /* "Other" is not a material. If the operator named what is actually
       loaded, show that instead — it is the whole point of asking. */
    const manual =
      f.key === "printMaterial" && isOtherMaterial(value) && settings.printMaterialOther;
    return { key: f.key, label: f.label, text: manual || value };
  });
};

/* Both lists say plain "Other" since 2026-08-18 (the task list used to say
   "Other (Discuss with Operator)"). Rows written before the rewording still
   hold the long value, and the shop can reword either column again, so
   match on the stem rather than on an exact string. */
const isOtherMaterial = (v) => /^\s*other\b/i.test(v || "");

/* Nothing mutates a printer's fields in place (updates spread), but creation
   sites still spread this so no two printers ever share the object. */
const DEFAULT_PRINTER_FIELDS = {
  nozzleSize: "0.4mm",
  nozzleType: "Standard",
  nozzleMaterial: "Standard",
  bedType: "Textured",
  printMaterial: "ABS",
};

/* Global task tag — same dropdown choices across all tasks */
const TASK_TAGS = ["Sliced", "Not Sliced", "Needs Nesting"];
/* only the dot color is used, in the context menu */
const SLICE_DOT = {
  Sliced: "#498205",
  "Not Sliced": "#8A8886",
  "Needs Nesting": "#CA5010",
};

/* Printer state — three the operator chooses, one the app sets. Replaces an
   on/off toggle plus an availability pill, which between them produced four
   states when only three meant anything. Stored as the Status choice column
   in the Printers list.
     accepts  can new work be dropped / added here
     evicts   does entering this state send queued jobs back to staging
     dim      is the card greyed out — reserved for "cannot print at all" */
/* What the operator can choose. Busy is deliberately absent: the app sets it,
   and offering it manually would give you a control that snaps back the moment
   nothing is running. */
const PRINTER_STATUSES = ["Ready", "Reserved", "Maintenance"];
const PRINTER_STATUS = {
  Ready: {
    color: "#498205",
    bg: "#DFF6DD",
    text: "#498205",
    blurb: "Available for new jobs",
    accepts: true,
    evicts: false,
    dim: false,
  },
  /* Set by the app, never chosen. See the Busy-reconciliation effect in
     PrintFarmScheduler: automation only ever moves a printer between Ready
     and Busy, so an operator's Reserved or Maintenance always outlives
     whatever the jobs are doing.

     Shares the "In progress" blue on purpose — the printer is busy *because* a
     task is in progress, and one colour for one fact is the rule this board
     now follows. */
  Busy: {
    color: "#0F6CBD",
    bg: "#DEECF9",
    text: "#0F6CBD",
    blurb: "Printing now; still queues new jobs",
    accepts: true,
    evicts: false,
    dim: false,
  },
  Reserved: {
    color: "#CA5010",
    bg: "#FDF0E7",
    text: "#CA5010",
    blurb: "Held for something specific; no new jobs",
    accepts: false,
    evicts: false,
    dim: false,
  },
  Maintenance: {
    color: "#8A8886",
    bg: "#F3F2F1",
    text: "#605E5C",
    blurb: "Out of service; queued jobs return to staging",
    accepts: false,
    evicts: true,
    dim: true,
  },
};

/* Bumped by hand in every commit that changes this file. It exists so that
   "is the change live yet?" is answerable by looking at the board instead of
   trusting a cache, a deploy log, or somebody's word — a stale Teams tab shows
   the old stamp. Deploys land silently and several caches sit in the way
   (GitHub's CDN, the browser's, Babel's separate fetch of this file, and Teams'
   own content cache), so a visible stamp is the only cheap way to tell a
   not-yet-deployed change apart from a not-yet-refreshed one. If you change
   this file and don't bump this, the stamp lies — which is worse than not
   having it. See docs/operations.md#deploying-a-change. */
const BUILD = "2026-08-18.22";
/* Teams app-package (manifest) version. Teams doesn't expose it to the tab at
   runtime, so this is hand-maintained: bump it in the same change that
   republishes the package from the Developer Portal, and nowhere else. */
const APP_VERSION = "1.0.1";

const STATUSES = ["Not started", "In progress", "Complete"];

/* A held or out-of-service machine must not have a job started on it. Reserved
   already refused *new* work; this closes the other half, where a job already
   queued could be set running anyway. Busy and Ready both allow it — Busy is
   just Ready with something on the bed. */
const canStartWork = (printerStatus) =>
  printerStatus === "Ready" || printerStatus === "Busy";

const PRIORITIES = ["Low", "Normal", "High", "Urgent"];
const PRIORITY_STYLE = {
  Low: { bg: "#EFF6FC", text: "#69797E" },
  Normal: { bg: "#F3F2F1", text: "#605E5C" },
  High: { bg: "#FDF0E7", text: "#CA5010" },
  Urgent: { bg: "#FDE7E9", text: "#D13438" },
};

const STATUS_STYLE = {
  "Not started": { dot: "#8A8886", bg: "#F3F2F1", text: "#605E5C" },
  "In progress": { dot: "#0F6CBD", bg: "#DEECF9", text: "#0F6CBD" },
  Complete: { dot: "#498205", bg: "#DFF6DD", text: "#498205" },
};

const STAGING = "staging";

/* ---- layout dimensions: fixed minimum widths that scale UP, never below ----
   A printer card must stay wide enough to show every field without clipping.
   The number of printer cards per group and groups per board row are a global
   setting (shop layout differs), so the min-width math derives from them. */
const PRINTER_MIN_W = 230;
const PRINTER_GAP = 12;
const GROUP_PAD = 32;
const GROUP_GAP = 16;

/* board-wide preferences — persisted in the Settings list.
   defaults match a 12-printer shop: groups of 4 shown 2-wide, 3 groups per row */
const DEFAULT_APP_SETTINGS = {
  stagingName: "Staging area",
  printersPerRow: 2,
  groupsPerRow: 3,
};

const groupMinW = (printersPerRow) =>
  PRINTER_MIN_W * printersPerRow + PRINTER_GAP * (printersPerRow - 1) + GROUP_PAD;
const boardMinW = (printersPerRow, groupsPerRow) =>
  groupMinW(printersPerRow) * groupsPerRow + GROUP_GAP * (groupsPerRow - 1);

/* Collision-safe IDs. A per-session counter would hand the same id to two
   people creating rows at the same time, so use a real UUID where available. */
const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/* ---------------------------- order helpers --------------------------- */

const bySortOrder = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0);

/* rows in from storage → array order the app can trust */
const hydrate = (rows) => [...rows].sort(bySortOrder);

/* one-row patch that keeps every other row's reference — the save layer
   diffs by object identity, so a handler must never hand back fresh objects
   for rows it did not touch. `patch` may be a function of the current row. */
const patchById = (rows, id, patch) =>
  rows.map((r) =>
    r.id === id ? { ...r, ...(typeof patch === "function" ? patch(r) : patch) } : r
  );

/* array order → sortOrder, renumbered per scope. Unchanged rows keep their
   identity so the save layer can diff by reference. */
const reindex = (rows, scopeOf = () => "board") => {
  const seen = {};
  return rows.map((r) => {
    const k = scopeOf(r);
    const i = (seen[k] = (seen[k] ?? -1) + 1);
    return r.sortOrder === i ? r : { ...r, sortOrder: i };
  });
};

/* ---- subtask naming (item 32) ----
   Subtask IDs read PropPart1-A, -B … -Z, then -AA (bijective base-26). The
   next letter comes from the highest suffix already on the job's subtasks —
   deleting an old run never shifts later names, and deleting the *latest*
   frees its letter for reuse. That reuse is accepted over storing a counter,
   which would cost a parent PATCH on every assignment.
   ponytail: suffixes are parsed back out of titles, so renaming the parent
   after runs exist restarts lettering at -A (titles may then repeat, which
   this app allows everywhere). Store a counter column if that ever bites. */
const lettersToNum = (s) => {
  let n = 0;
  for (const ch of s) {
    const v = ch.charCodeAt(0) - 64; // 'A' → 1
    if (v < 1 || v > 26) return 0;
    n = n * 26 + v;
  }
  return n;
};

const numToLetters = (n) => {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const nextSubtaskSuffix = (parentTitle, subtasks) => {
  const prefix = `${parentTitle}-`;
  let max = 0;
  subtasks.forEach((t) => {
    const title = t.title || "";
    if (!title.startsWith(prefix)) return;
    const suffix = title.slice(prefix.length);
    /* only real suffix shapes count — a hand-renamed run like "Bracket-REDO"
       would otherwise parse as millions and jump the lettering forever */
    if (!/^[A-Z]{1,2}$/.test(suffix)) return;
    const v = lettersToNum(suffix);
    if (v > max) max = v;
  });
  return numToLetters(max + 1);
};

/* --------------------------- seed demo data --------------------------- */

const seedGroups = reindex([
  { id: "g1", name: "Prusa Farm", collapsed: false, color: "#5B5FC7" },
  { id: "g2", name: "Large Format", collapsed: false, color: "#038387" },
]);

const seedPrinters = reindex(
  [
    {
      id: "p1",
      name: "MK4 — Alpha",
      groupId: "g1",
      status: "Ready",
      settings: {
        fields: { nozzleSize: "0.4mm", nozzleType: "Standard", nozzleMaterial: "Hardened", bedType: "Smooth", printMaterial: "ABS" },
        notes: "Recently re-calibrated. First layer dialed in.",
      },
    },
    {
      id: "p2",
      name: "MK4 — Bravo",
      groupId: "g1",
      status: "Ready",
      settings: {
        fields: { nozzleSize: "0.4mm", nozzleType: "Standard", nozzleMaterial: "Standard", bedType: "Textured", printMaterial: "ABS" },
        notes: "",
      },
    },
    {
      id: "p3",
      name: "XL — Charlie",
      groupId: "g2",
      status: "Maintenance",
      settings: {
        fields: { nozzleSize: "0.8mm", nozzleType: "High Flow", nozzleMaterial: "Tungsten", bedType: "Textured", printMaterial: "Other" },
        notes: "Down for hotend service until parts arrive.",
        printMaterialOther: "PC-CF",
      },
    },
  ],
  (p) => p.groupId
);

const buildSeedTasks = () => {
  const base = [
    {
      id: "t1",
      printerId: "p1",
      title: "Bracket set — 12pcs",
      jobcode: "AX112",
      needByDate: "2026-06-18",
      notes: "Two of these are spares — flag if the first comes out clean.",
      operatorNotes: "Bed re-levelled before this run. Watch layer 40.",
      status: "In progress",
      etaDate: "2026-06-15",
      etaTime: "14:30",
      sliceStatus: "Sliced",
      sentBy: "Dana",
      giveTo: "Assembly",
      filepath: "\\\\farm\\queue\\bracket_set_x12.3mf",
      quantity: 12,
      priority: "High",
      createdAt: "2026-06-12T15:05:00Z",
    },
    {
      id: "t2",
      printerId: "p1",
      title: "Enclosure vents v3",
      jobcode: "BY113",
      status: "Not started",
      etaDate: "2026-06-19",
      etaTime: "09:00",
      sliceStatus: "Needs Nesting",
      sentBy: "Marco",
      giveTo: "QA",
      createdAt: "2026-06-14T09:30:00Z",
    },
    {
      id: "t3",
      printerId: "p2",
      title: "Jig plates — batch 2",
      jobcode: "AX112",
      status: "In progress",
      etaDate: "2026-06-13",
      etaTime: "17:00",
      sliceStatus: "Sliced",
      sentBy: "Priya",
      giveTo: "Dana",
      createdAt: "2026-06-11T11:20:00Z",
    },
    {
      id: "t5",
      printerId: STAGING,
      title: "Prototype housing rev B",
      notes: "Rev B only — rev A files are still on the share, ignore them.",
      status: "Not started",
      etaDate: "2026-06-20",
      etaTime: "10:00",
      sliceStatus: "Not Sliced",
      sentBy: "Front desk",
      giveTo: "",
      createdAt: "2026-06-13T08:00:00Z",
    },
    {
      id: "t6",
      printerId: "p1",
      title: "Cable clips — run 1",
      status: "Complete",
      etaDate: "2026-06-10",
      etaTime: "16:00",
      sliceStatus: "Sliced",
      sentBy: "Marco",
      giveTo: "Assembly",
      quantity: 40,
      priority: "Normal",
      createdAt: "2026-06-08T13:45:00Z",
      completedAt: "2026-06-10T15:52:00Z",
    },
  ];

  /* demo volume: a pile of staging parts with mixed priorities so the
     priority sort, tier headers, search, and paging are all exercised */
  const people = ["Dana", "Marco", "Priya", "Front desk", "Lena", "Sam", "Workshop"];
  const parts = [
    "Hinge bracket", "Vent grille", "Spacer ring", "Cable guide", "Mount plate",
    "End cap", "Knob", "Standoff", "Clip", "Gasket frame", "Bushing", "Adapter",
    "Housing shell", "Strain relief", "Lever arm", "Foot pad", "Cover panel",
    "Pulley", "Funnel", "Drawer pull",
  ];
  const prios = ["Urgent", "High", "High", "Normal", "Normal", "Normal", "Normal", "Low", "Low"];
  const slice = ["Not Sliced", "Needs Nesting", "Sliced"];
  for (let i = 0; i < 48; i++) {
    base.push({
      id: `seed-task-${i}`,
      printerId: STAGING,
      title: `${parts[i % parts.length]} — job ${100 + i}`,
      jobcode: `${"ABCDEFGH"[i % 8]}${"XYZ"[i % 3]}${String(100 + i).slice(-3)}`,
      status: "Not started",
      etaDate: "",
      etaTime: "",
      needByDate: i % 3 === 0 ? `2026-08-${String(10 + (i % 18)).padStart(2, "0")}` : "",
      sliceStatus: slice[i % slice.length],
      sentBy: people[i % people.length],
      giveTo: people[(i + 3) % people.length],
      quantity: (i % 5) + 1,
      priority: prios[i % prios.length],
      /* staggered so same-tier, same-need-by jobs still have a real
         created-at order to exercise the sort's 3rd tiebreaker */
      createdAt: new Date(Date.now() - (48 - i) * 6 * 3600 * 1000).toISOString(),
    });
  }
  return base;
};

const seedTasks = reindex(buildSeedTasks(), (t) => t.printerId);

/* ----------------------------- helpers -------------------------------- */

function formatEta(etaDate, etaTime) {
  if (!etaDate && !etaTime) return null;
  let datePart = "";
  if (etaDate) {
    const [y, m, d] = etaDate.split("-");
    datePart = `${m}/${d}/${y}`;
  }
  return { date: datePart, time: etaTime || "" };
}

/* Dismiss-on-backdrop handlers for a modal.

   A click belongs to the nearest common ancestor of where the mouse went
   down and where it came up. Select text inside a panel and release past
   its edge and that ancestor is the backdrop, so a plain onClick reads the
   drag as a click on the backdrop and closes the modal mid-edit. Remember
   where the press landed instead of inferring it from the release. */
function useBackdropClose(onClose) {
  const pressedBackdrop = useRef(false);
  return {
    onMouseDown: (e) => {
      pressedBackdrop.current = e.target === e.currentTarget;
    },
    onClick: (e) => {
      if (e.target === e.currentTarget && pressedBackdrop.current) onClose();
      pressedBackdrop.current = false;
    },
  };
}

/* Past-due test. A date with no time is due at end of that day, so a job
   due today doesn't read as late all morning. Complete jobs never count. */
function isOverdue(task) {
  if (!task.etaDate || task.status === "Complete") return false;
  const [y, m, d] = task.etaDate.split("-").map(Number);
  if (!y || !m || !d) return false;
  const due = task.etaTime
    ? new Date(y, m - 1, d, ...task.etaTime.split(":").map(Number))
    : new Date(y, m - 1, d, 23, 59, 59);
  return due.getTime() < Date.now();
}

/* One-click ETA presets. Operator feedback: typing a date and a time per
   run doesn't scale to hundreds of runs. Printers run unattended, so the
   ETA is the actual finish instant — now plus the bucket's hours, no
   business-hours or weekend rounding. */
function quickEta(hours) {
  const t = new Date(Date.now() + hours * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    etaDate: `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`,
    etaTime: `${pad(t.getHours())}:${pad(t.getMinutes())}`,
  };
}

const ETA_PRESETS = [
  ["Short", "~3 hrs", 3],
  ["Medium", "~6 hrs", 6],
  ["Long", "~24 hrs", 24],
  ["Weekend", "2–3 days", 72],
];

/* CreatedAt/CompletedAt stamp. A real instant, not a date-input string —
   see the note by taskFromRow/taskToRow before touching either field. */
const nowIso = () => new Date().toISOString();

/* Display only, for the two stamps above — not used for sorting or storage. */
function formatTimestamp(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

/* ------------------------------- app ---------------------------------- */

/* `initial` and `onPersist` are supplied by AppShell when SharePoint is
   configured. With neither, the board runs on sample data exactly as it
   did before Phase 2. */
export default function PrintFarmScheduler({ initial = null, onPersist = null, liveApi = null }) {
  /* hydrate() is the entry point storage rows will use too.
     Group collapse is remembered per browser like the view toggle — never
     SharePoint (see the note by groupFromRow). The overlay makes fresh
     objects only at init, so the save layer's identity baseline is intact;
     a flagged group still costs nothing because toRow drops `collapsed`. */
  const [groups, setGroups] = useState(() => {
    let folded;
    try {
      folded = new Set(JSON.parse(localStorage.getItem("pfs.collapsedGroups")) || []);
    } catch {
      folded = new Set();
    }
    return hydrate(initial?.groups ?? seedGroups).map((g) =>
      folded.has(g.id) ? { ...g, collapsed: true } : g
    );
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        "pfs.collapsedGroups",
        JSON.stringify(groups.filter((g) => g.collapsed).map((g) => g.id))
      );
    } catch {
      /* not remembering the fold is survivable */
    }
  }, [groups]);
  const [printers, setPrinters] = useState(() => hydrate(initial?.printers ?? seedPrinters));
  const [tasks, setTasks] = useState(() => hydrate(initial?.tasks ?? seedTasks));
  const [appSettings, setAppSettings] = useState(initial?.appSettings ?? DEFAULT_APP_SETTINGS);
  /* PERSISTENCE SEAM: the choice columns read from SharePoint on sign-in,
     so equipment options are editable without a code change. */
  const [choices, setChoices] = useState(initial?.choices ?? DEFAULT_CHOICES);

  /* Hand every change to the save layer. The first run is skipped —
     what we were just given is by definition already stored. */
  const persistedOnce = useRef(false);
  useEffect(() => {
    if (!onPersist) return;
    if (!persistedOnce.current) {
      persistedOnce.current = true;
      return;
    }
    onPersist({ groups, printers, tasks, appSettings });
  }, [groups, printers, tasks, appSettings, onPersist]);

  const [openSettings, setOpenSettings] = useState({});
  const [addingTaskIn, setAddingTaskIn] = useState(null); // printerId or STAGING
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [removeGroupMode, setRemoveGroupMode] = useState(false);
  const [editPrintersMode, setEditPrintersMode] = useState(false);
  const [showShopSettings, setShowShopSettings] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // {type, id, x, y}
  const [draggingTaskId, setDraggingTaskId] = useState(null);
  const [confirm, setConfirm] = useState(null); // {title, body, confirmLabel, onConfirm}
  const [jobcodeFilter, setJobcodeFilter] = useState(""); // "" = show everything

  /* Operator view is the board as built; designer view hides the controls that
     configure the shop or assign work.

     This is NOT a permission boundary. The toggle is one click for anybody and
     the data is untouched — it removes clutter and prevents accidents, nothing
     more. Real enforcement would need SharePoint permissions and a server-side
     check, which this app deliberately does not have.

     Remembered per browser, like group collapse and the history panel's
     fold. Still per-person, and still nothing SharePoint knows about. */
  const [designerView, setDesignerView] = useState(() => {
    try {
      return localStorage.getItem("pfs.view") === "designer";
    } catch {
      return false; // private mode, blocked storage — default to operator
    }
  });
  const operator = !designerView;
  useEffect(() => {
    try {
      localStorage.setItem("pfs.view", designerView ? "designer" : "operator");
    } catch {
      /* not remembering the choice is survivable; failing to render is not */
    }
  }, [designerView]);

  /* ---- live refresh (item 11) ----
     AppShell polls SharePoint and hands the fresh lists here; the merge
     rules live in mergeList. Registered every render (no dep array) so the
     closure always sees current state. onBaseline must run before the
     setters: by the time the persist effect diffs the merged state, the
     save layer has to already regard every adopted row as stored. */
  useEffect(() => {
    if (!liveApi) return;
    liveApi.current = {
      applyRemote(remote, onBaseline) {
        /* rows that must not change under the person using them */
        const hold = new Set(
          [expandedTaskId, draggingTaskId].filter(Boolean)
        );
        const none = new Set();
        const g = mergeList(
          groups, remote.groups, none, LISTS.groups.toRow,
          /* collapse is per-person view state — never let a remote edit
             unfold someone's board */
          (lr, rr) => ({ ...rr, collapsed: lr.collapsed })
        );
        const p = mergeList(printers, remote.printers, none, LISTS.printers.toRow);
        const t = mergeList(tasks, remote.tasks, hold, LISTS.tasks.toRow);
        onBaseline({
          groups: g.saved,
          printers: p.saved,
          tasks: t.saved,
          appSettings,
        });
        if (g.state !== groups) setGroups(g.state);
        if (p.state !== printers) setPrinters(p.state);
        if (t.state !== tasks) setTasks(t.state);
      },
    };
  });

  /* declared here, not at the modal, because the modal renders conditionally
     and a hook cannot */
  const shopSettingsBackdrop = useBackdropClose(() => setShowShopSettings(false));

  /* close context menu on any click / escape / scroll */
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  /* global drag cleanup: dragend can be missed when the dragged card
     unmounts mid-drop, which left cards greyed out — always clear here */
  useEffect(() => {
    const clear = () => setDraggingTaskId(null);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, []);

  /* ---- derived: one pass over tasks instead of a filter per printer ---- */
  const tasksByPrinter = useMemo(() => {
    const map = {};
    tasks.forEach((t) => {
      (map[t.printerId] ||= []).push(t);
    });
    return map;
  }, [tasks]);

  /* ---- job/subtask split (item 32) ----
     A row with parentId set is a subtask — one print run on one printer. A
     row without one that lives in STAGING is a Job; whether it renders in
     the Staging block or the In Progress block is *derived* from whether it
     has subtasks, so the "move" between those blocks costs zero writes and
     leaves the identity-diff save layer nothing to diff. Rows without a
     parentId that sit on a printer predate the model and behave as before. */
  const subtasksByParent = useMemo(() => {
    const map = {};
    tasks.forEach((t) => {
      if (t.parentId) (map[t.parentId] ||= []).push(t);
    });
    return map;
  }, [tasks]);

  const stagingRows = tasksByPrinter[STAGING] || [];

  /* Staging = jobs not yet assigned anywhere. Completed jobs are excluded —
     their home is the history table — and so are subtasks, which belong on
     printers: an orphaned run (its printer deleted mid-flight) should not be
     mistaken for a job waiting to be assigned. */
  const stagingTasks = useMemo(
    () =>
      stagingRows.filter(
        (t) =>
          !t.parentId &&
          t.status !== "Complete" &&
          !(subtasksByParent[t.id]?.length)
      ),
    [stagingRows, subtasksByParent]
  );

  /* In Progress = jobs with at least one run on a printer, until the job
     completes (see the auto-complete effect below). */
  const inProgressJobs = useMemo(
    () =>
      stagingRows.filter(
        (t) =>
          !t.parentId &&
          t.status !== "Complete" &&
          (subtasksByParent[t.id]?.length)
      ),
    [stagingRows, subtasksByParent]
  );

  /* Designer view's completed-jobs table needs every finished task
     regardless of printer — the one category of assigned-job info that
     view otherwise hides entirely (ui-reference.md). */
  const completedTasks = useMemo(
    () => tasks.filter((t) => t.status === "Complete"),
    [tasks]
  );

  /* Live work sitting on a printer, shared by the two jobcode memos below.
     Staging is excluded because the filter dims printers, and a job with no
     printer cannot tell you anything about one. Completed jobs are excluded
     too — "assigned or in progress" is about what the shop is working on now. */
  const liveRows = useMemo(
    () => tasks.filter((t) => t.printerId !== STAGING && t.status !== "Complete"),
    [tasks]
  );

  /* jobcodes worth filtering by */
  const liveJobcodes = useMemo(
    () =>
      [...new Set(liveRows.map((t) => t.jobcode).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b)
      ),
    [liveRows]
  );

  /* Printer ids carrying the selected jobcode. Everything else dims. */
  const jobcodeMatches = useMemo(() => {
    if (!jobcodeFilter) return null;
    return new Set(
      liveRows.filter((t) => t.jobcode === jobcodeFilter).map((t) => t.printerId)
    );
  }, [liveRows, jobcodeFilter]);

  /* A jobcode can stop being live while it is selected — the last job on it
     finishes, or moves back to staging. Drop the selection rather than leaving
     the board dimmed against something that no longer exists. */
  useEffect(() => {
    if (jobcodeFilter && !liveJobcodes.includes(jobcodeFilter)) setJobcodeFilter("");
  }, [liveJobcodes, jobcodeFilter]);

  const expandedTask = tasks.find((t) => t.id === expandedTaskId) || null;

  /* ------------------------- mutations -------------------------------- */

  /* any structural task change renumbers sortOrder within its printer */
  const setTasksOrdered = (fn) =>
    setTasks((ts) => reindex(fn(ts), (t) => t.printerId));

  const updatePrinter = (id, patch) =>
    setPrinters((ps) => patchById(ps, id, patch));

  const updatePrinterSettings = (id, patch) =>
    setPrinters((ps) =>
      patchById(ps, id, (p) => ({ settings: { ...p.settings, ...patch } }))
    );

  const updatePrinterField = (id, key, value) =>
    setPrinters((ps) =>
      patchById(ps, id, (p) => ({
        settings: { ...p.settings, fields: { ...p.settings.fields, [key]: value } },
      }))
    );

  /* Moving a printer to Maintenance sends its queued legacy jobs back to
     staging. Subtasks stay put: a run cannot live in staging (staging holds
     jobs), and silently deleting it would eat the operator's notes — so it
     rides out the maintenance on the card, ready to be dragged to another
     printer or deleted deliberately. */
  const setPrinterStatus = (id, status) => {
    updatePrinter(id, { status });
    if (PRINTER_STATUS[status]?.evicts) {
      setTasksOrdered((ts) =>
        ts.map((t) =>
          t.printerId === id && !t.parentId ? { ...t, printerId: STAGING } : t
        )
      );
    }
  };

  /* Busy follows the work: a printer with something In progress is Busy, one
     without is Ready. Automation only ever moves between those two — Reserved
     and Maintenance are the operator's word and outlast any job.

     Returns the same array when nothing moved. That is not an optimisation:
     the save layer diffs by object identity, so handing back a fresh array of
     fresh rows every time tasks changed would PATCH every printer on every
     keystroke. */
  useEffect(() => {
    setPrinters((ps) => {
      let moved = false;
      const next = ps.map((p) => {
        if (p.status !== "Ready" && p.status !== "Busy") return p;
        const running = tasks.some(
          (t) => t.printerId === p.id && t.status === "In progress"
        );
        const want = running ? "Busy" : "Ready";
        if (p.status === want) return p;
        moved = true;
        return { ...p, status: want };
      });
      return moved ? next : ps;
    });
  }, [tasks]);

  /* A job completes itself: the moment its total is fully assigned and every
     run is Complete, the parent is stamped Complete — it leaves In Progress
     and joins the history table as a summary row. Two-way, like Busy above:
     reopening a run (or adding one) takes the stamp back off. Only jobs with
     runs are ever touched — a plain staging row someone completes by hand is
     their business. Same identity discipline as the Busy effect: untouched
     rows keep their reference, and the same array returns when nothing
     changed, or the save layer would PATCH every task each time one moved. */
  useEffect(() => {
    setTasks((ts) => {
      const byParent = {};
      ts.forEach((t) => {
        if (t.parentId) (byParent[t.parentId] ||= []).push(t);
      });
      let changed = false;
      const next = ts.map((t) => {
        if (t.parentId || t.printerId !== STAGING) return t;
        const subs = byParent[t.id];
        if (!subs || subs.length === 0) return t;
        const assigned = subs.reduce((n, s) => n + (Number(s.quantity) || 0), 0);
        const done =
          assigned >= (Number(t.quantity) || 1) &&
          subs.every((s) => s.status === "Complete");
        const want = done
          ? "Complete"
          : t.status === "Complete"
          ? "In progress"
          : t.status;
        if (want === t.status) return t;
        changed = true;
        return {
          ...t,
          status: want,
          completedAt: want === "Complete" ? nowIso() : "",
        };
      });
      return changed ? next : ts;
    });
  }, [tasks]);

  /* only a Ready printer takes new work */
  const acceptsTasks = (printerId) => {
    if (printerId === STAGING) return true;
    const p = printers.find((x) => x.id === printerId);
    return !!p && PRINTER_STATUS[p.status]?.accepts;
  };

  /* completedAt tracks the status patch, not a field anyone edits directly:
     stamped the instant a task becomes Complete, cleared the instant it
     doesn't — a completed-at value on a task that isn't Complete would be a
     stale fact with no visible meaning.

     Only on an actual *transition*. The context menu offers every status
     including the one already set, so re-picking Complete on a finished job
     would otherwise rewrite its completion time to now — and PATCH the row
     to record that it finished at the moment someone looked at the menu. */
  const updateTask = (id, patch) =>
    setTasks((ts) =>
      patchById(ts, id, (t) => {
        const next = { ...patch };
        if ("status" in patch && patch.status !== t.status) {
          next.completedAt = patch.status === "Complete" ? nowIso() : "";
        }
        return next;
      })
    );

  const deleteTask = (id) => {
    /* A job's runs go with it — a run whose parentId points at nothing is
       invisible to both panels and can never auto-complete. */
    setTasksOrdered((ts) => ts.filter((t) => t.id !== id && t.parentId !== id));
    setExpandedTaskId((cur) => (cur === id ? null : cur));
  };

  /* Assigning a job to a printer creates a *subtask* — the job itself stays
     in STAGING and renders in the In Progress block from now on (derived, no
     write to the parent). The run copies the job's request fields at
     creation; later edits to the job do not propagate. Quantity defaults to
     the job's remaining (total minus every run so far, finished ones
     included) and the editor opens on the new run so the operator can adjust
     it — the same open-after-assign flow drops have always had. */
  const assignSubtask = (job, printerId) => {
    const subs = subtasksByParent[job.id] || [];
    /* first run = the job starts printing (item 12): ping its creator and
       the Notify list, fire-and-forget from this session. Later runs are
       the same job still going — no new ping. */
    if (subs.length === 0) {
      const printerName =
        printers.find((p) => p.id === printerId)?.name || "a printer";
      sendActivityPings({
        activityType: "jobStarted",
        preview: `${job.title} started printing on ${printerName}`,
        jobName: job.title,
        userIds: [job.createdById, ...(job.notifyPeople || []).map((p) => p.id)],
      });
    }
    const assigned = subs.reduce((n, s) => n + (Number(s.quantity) || 0), 0);
    /* fully-assigned jobs can still take another run (a failed print needs a
       reprint before anything completes) — default that run to 1, not 0 */
    const remaining = Math.max((Number(job.quantity) || 1) - assigned, 1);
    const id = uid();
    setTasksOrdered((ts) => [
      ...ts,
      {
        ...job,
        id,
        parentId: job.id,
        printerId,
        title: `${job.title}-${nextSubtaskSuffix(job.title, subs)}`,
        status: "Not started",
        quantity: remaining,
        etaDate: "",
        etaTime: "",
        operatorNotes: "",
        createdAt: nowIso(),
        completedAt: "",
      },
    ]);
    setExpandedTaskId(id);
  };

  /* drop on a column's open area: move to that printer, at the end */
  const moveTask = (taskId, destPrinterId) => {
    setDraggingTaskId(null);
    if (!acceptsTasks(destPrinterId)) return;
    const source = tasks.find((t) => t.id === taskId);
    if (!source) return;
    /* A subtask never returns to staging — staging holds jobs, not print
       runs. Deleting the run (context menu) is the deliberate way to
       un-assign one; its quantity flows back into the job's remaining the
       moment the row is gone, since remaining is derived. */
    if (destPrinterId === STAGING && source.parentId) return;
    /* Dropping a staging job back on staging has nothing left to do: staging
       order is computed (priority → need-by → created-at), so the move would
       be invisible — while still shuffling array position and renumbering
       every staging row after it, i.e. a PATCH per row for no visible effect.
       A printer queue is different: it still orders by sortOrder, so dropping
       a job on its own printer legitimately sends it to the back. */
    if (destPrinterId === STAGING && source.printerId === STAGING) return;
    /* out of staging = an assignment, not a move (item 32) */
    if (source.printerId === STAGING && destPrinterId !== STAGING) {
      assignSubtask(source, destPrinterId);
      return;
    }
    setTasksOrdered((ts) => {
      const dragged = ts.find((t) => t.id === taskId);
      if (!dragged) return ts;
      const without = ts.filter((t) => t.id !== taskId);
      return [...without, { ...dragged, printerId: destPrinterId }];
    });
  };

  /* drop onto a specific card: insert before/after it */
  const moveTaskRelative = (taskId, targetTaskId, position) => {
    setDraggingTaskId(null);
    if (taskId === targetTaskId) return;
    const source = tasks.find((t) => t.id === taskId);
    const targetNow = tasks.find((t) => t.id === targetTaskId);
    if (!source || !targetNow || !acceptsTasks(targetNow.printerId)) return;
    /* out of staging = an assignment here too; the drop position is moot —
       the new run lands at the end of the printer's queue like any drop */
    if (source.printerId === STAGING && targetNow.printerId !== STAGING) {
      assignSubtask(source, targetNow.printerId);
      return;
    }
    setTasksOrdered((ts) => {
      const dragged = ts.find((t) => t.id === taskId);
      const target = ts.find((t) => t.id === targetTaskId);
      if (!dragged || !target) return ts;
      const without = ts.filter((t) => t.id !== taskId);
      const idx = without.findIndex((t) => t.id === targetTaskId);
      const insertAt = position === "after" ? idx + 1 : idx;
      const updated = { ...dragged, printerId: target.printerId };
      return [...without.slice(0, insertAt), updated, ...without.slice(insertAt)];
    });
  };

  /* A duplicated run is a real new run — it takes the next suffix letter and
     counts against its job like any other, not a "(copy)" that reads like a
     mistake. Rows without a parent (jobs, legacy tasks) keep the old
     behaviour. Orphaned runs (parent deleted) fall back to "(copy)" too:
     there is no parent title to derive from. */
  const dupTitle = (ts, row) => {
    const parent = row.parentId ? ts.find((t) => t.id === row.parentId) : null;
    return parent
      ? `${parent.title}-${nextSubtaskSuffix(
          parent.title,
          ts.filter((t) => t.parentId === row.parentId)
        )}`
      : `${row.title} (copy)`;
  };

  /* What every copy/reprint path resets: a copy is a new piece of work, not
     a continuation of the original's history — fresh creation stamp, no
     inherited completion, its own prediction, its own working notes. */
  const runReset = () => ({
    status: "Not started",
    etaDate: "",
    etaTime: "",
    operatorNotes: "",
    createdAt: nowIso(),
    completedAt: "",
  });

  /* duplicate a task in place; copies always reset to Not started */
  const copyTask = (taskId) => {
    setTasksOrdered((ts) => {
      const idx = ts.findIndex((t) => t.id === taskId);
      if (idx === -1) return ts;
      const copy = {
        ...ts[idx],
        id: uid(),
        title: dupTitle(ts, ts[idx]),
        ...runReset(),
      };
      return [...ts.slice(0, idx + 1), copy, ...ts.slice(idx + 1)];
    });
  };

  /* "Complete & reprint" (item 33): one action that completes the run and
     queues its successor — the shop-floor case is a run that finished with
     some parts bad and needs N more. The completed row heads for the history
     table (item 31); the successor starts Not started on the same printer
     with the same quantity, and the editor opens on it so the quantity gets
     corrected before anyone reads it as fact. Completing here matches
     updateTask's transition rule: the guard filters out already-Complete
     rows, so the stamp only ever writes on a real transition. Both rows
     change in one update — one PATCH, one POST, nothing else moves. The
     successor also keeps the parent from auto-completing in the same pass. */
  const completeAndReprint = (taskId) => {
    const cur = tasks.find((t) => t.id === taskId);
    if (!cur || cur.status === "Complete" || cur.printerId === STAGING) return;
    const id = uid();
    setTasksOrdered((ts) => {
      const row = ts.find((t) => t.id === taskId);
      if (!row || row.status === "Complete") return ts;
      const copy = {
        ...row,
        id,
        title: dupTitle(ts, row),
        ...runReset(),
      };
      return [
        ...patchById(ts, taskId, { status: "Complete", completedAt: nowIso() }),
        copy,
      ];
    });
    setExpandedTaskId(id);
  };

  /* Recall from history: a fresh job in staging built from a completed row.
     The original is deliberately never un-completed — the table is a record,
     not a queue, and a job whose runs still cover its quantity would just
     auto-complete itself again in the same pass. Runs recalled this way come
     back as standalone jobs (parentId stripped): their old job is finished,
     and a run must never sit in staging (item 32). */
  const reprintTask = (taskId) => {
    const id = uid();
    setTasksOrdered((ts) => {
      const row = ts.find((t) => t.id === taskId);
      if (!row) return ts;
      return [
        ...ts,
        {
          ...row,
          id,
          parentId: "",
          printerId: STAGING,
          ...runReset(),
        },
      ];
    });
    /* open the editor on the recall, same reason Complete & reprint does:
       the copied quantity is a guess until someone confirms it */
    setExpandedTaskId(id);
  };

  const addTask = (printerId, fields) => {
    setTasksOrdered((ts) => [
      ...ts,
      /* createdAt last, so nothing in `fields` can pass off a stale value
         as the creation instant */
      { id: uid(), printerId, status: "Not started", ...fields, createdAt: nowIso() },
    ]);
    setAddingTaskIn(null);
    /* new job in staging → ping the operator role (item 12). Empty list
       today, so this is a no-op until OPERATOR_NOTIFY_IDS is filled. */
    if (printerId === STAGING && OPERATOR_NOTIFY_IDS.length)
      sendActivityPings({
        activityType: "jobQueued",
        preview: `New job in staging: ${fields.title || "untitled"}`,
        jobName: fields.title || "untitled",
        userIds: OPERATOR_NOTIFY_IDS,
      });
  };

  const toggleGroup = (id) =>
    setGroups((gs) => patchById(gs, id, (g) => ({ collapsed: !g.collapsed })));

  const renameGroup = (id, name) => {
    const clean = name.trim();
    if (clean) setGroups((gs) => patchById(gs, id, { name: clean }));
    setEditingGroupId(null);
  };

  const addGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    setGroups((gs) =>
      reindex([
        ...gs,
        { id: uid(), name, collapsed: false, color: nextGroupColor(gs) },
      ])
    );
    setNewGroupName("");
    setShowNewGroup(false);
  };

  /* Deleting a printer (or a group of them) treats the two row kinds
     differently: a legacy task falls back to staging as always, but a
     subtask is deleted with its printer — a run cannot live in staging, and
     its quantity flows back into the job's remaining the moment the row is
     gone, since remaining is derived. The confirmation dialogs say so. */
  const evictPrinterTasks = (ts, printerIds) =>
    ts
      .filter((t) => !(printerIds.includes(t.printerId) && t.parentId))
      .map((t) =>
        printerIds.includes(t.printerId) ? { ...t, printerId: STAGING } : t
      );

  /* delete a group: remove its printers; their tasks fall back to staging */
  const deleteGroup = (groupId) => {
    const printerIds = printers
      .filter((p) => p.groupId === groupId)
      .map((p) => p.id);
    setTasksOrdered((ts) => evictPrinterTasks(ts, printerIds));
    setPrinters((ps) => reindex(ps.filter((p) => p.groupId !== groupId), (p) => p.groupId));
    setGroups((gs) => reindex(gs.filter((g) => g.id !== groupId)));
  };

  const addPrinter = (groupId) => {
    setPrinters((ps) =>
      reindex(
        [
          ...ps,
          {
            id: uid(),
            name: "New printer",
            groupId,
            status: "Ready",
            settings: { fields: { ...DEFAULT_PRINTER_FIELDS }, notes: "" },
          },
        ],
        (p) => p.groupId
      )
    );
  };

  const deletePrinter = (id) => {
    setPrinters((ps) => reindex(ps.filter((p) => p.id !== id), (p) => p.groupId));
    setTasksOrdered((ts) => evictPrinterTasks(ts, [id]));
  };

  /* ---------------------- destructive confirmations -------------------- */

  /* what deleting these printers does to their rows, spelled out for the
     confirmation: legacy tasks return to staging, subtasks are removed and
     their quantity returns to the job (remaining is derived) */
  const evictionSummary = (printerIds, plural) => {
    const affected = tasks.filter((t) => printerIds.includes(t.printerId));
    const runs = affected.filter((t) => t.parentId).length;
    const legacy = affected.length - runs;
    if (!affected.length)
      return `Nothing is assigned to ${plural ? "its printers" : "it"}.`;
    const parts = [];
    if (legacy)
      parts.push(
        `${legacy} job${legacy !== 1 ? "s" : ""} move${legacy === 1 ? "s" : ""} back to the staging area`
      );
    if (runs)
      parts.push(
        `${runs} print run${runs !== 1 ? "s" : ""} ${runs === 1 ? "is" : "are"} removed — their quantity returns to their job's remaining`
      );
    return parts.join("; ") + ".";
  };

  const askDeleteGroup = (groupId) => {
    const g = groups.find((x) => x.id === groupId);
    const gp = printers.filter((p) => p.groupId === groupId);
    setConfirm({
      title: `Delete “${g?.name}”?`,
      confirmLabel: "Delete group",
      body: (
        <>
          <p className="text-sm mb-1" style={{ color: "#605E5C" }}>
            This permanently deletes the group and its{" "}
            <strong>
              {gp.length} printer{gp.length !== 1 ? "s" : ""}
            </strong>
            .
          </p>
          <p className="text-sm" style={{ color: "#605E5C" }}>
            {evictionSummary(gp.map((p) => p.id), true)}
          </p>
        </>
      ),
      onConfirm: () => {
        deleteGroup(groupId);
        setRemoveGroupMode(false);
      },
    });
  };

  const askDeletePrinter = (printerId) => {
    const p = printers.find((x) => x.id === printerId);
    setConfirm({
      title: `Delete “${p?.name}”?`,
      confirmLabel: "Delete printer",
      body: (
        <p className="text-sm" style={{ color: "#605E5C" }}>
          This permanently deletes the printer.{" "}
          {evictionSummary([printerId], false)}
        </p>
      ),
      onConfirm: () => deletePrinter(printerId),
    });
  };

  const openMenu = (type) => (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ type, id, x: e.clientX, y: e.clientY });
  };
  const openTaskMenu = openMenu("task");
  const openPrinterMenu = openMenu("printer");

  /* history rows get their own menu type: the full task menu offers status,
     moves and delete, none of which belong on a finished record */
  const openHistoryMenu = openMenu("history");

  /* the expand toggle and drag wiring repeat on every task-hosting block */
  const toggleExpand = (id) =>
    setExpandedTaskId((cur) => (cur === id ? null : id));
  const dragProps = {
    onDragStart: setDraggingTaskId,
    onDragEnd: () => setDraggingTaskId(null),
  };

  /* ------------------------------ render ------------------------------ */

  return (
    <div
      className="min-h-screen"
      style={{
        background: "#F0F0F2",
        fontFamily:
          "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', sans-serif",
      }}
    >
      {/* board scrolls horizontally below its minimum width; thin styled bar */}
      <style>{`
        /* overflow-y is computed to auto here regardless (one axis non-visible
           forces the other), so the board IS a clip container on both axes —
           anything that must escape it has to be position: fixed */
        .pp-board-scroll { overflow-x: auto; }
        .pp-board-scroll::-webkit-scrollbar { height: 10px; }
        .pp-board-scroll::-webkit-scrollbar-track { background: #E8E8EC; border-radius: 5px; }
        .pp-board-scroll::-webkit-scrollbar-thumb { background: #C0BFCC; border-radius: 5px; }
        .pp-board-scroll::-webkit-scrollbar-thumb:hover { background: #A6A4B5; }
      `}</style>

      {/* ---------------- app header ---------------- */}
      <header
        className="px-5 py-3 flex items-center gap-3"
        style={{ background: "#5B5FC7", color: "white" }}
      >
        <div
          className="w-8 h-8 rounded flex items-center justify-center font-bold text-xs"
          style={{ background: "rgba(255,255,255,0.2)" }}
        >
          PFS
        </div>
        <div>
          <div className="font-semibold leading-tight">Print Farm Scheduler</div>
          <div className="text-xs opacity-80 leading-tight">
            Team tab · {printers.length} printers ·{" "}
            {tasks.filter((t) => !t.parentId).length} jobs ·{" "}
            <span title={`Teams app package version ${APP_VERSION}. Code version this tab is running follows — if it doesn't match the latest build, you're on a cached copy: hard-refresh, or fully quit and reopen Teams.`}>
              v{APP_VERSION} · build {BUILD}
            </span>
          </div>
        </div>
        {/* View toggle. Deliberately says what you get, not what you are:
            nothing here identifies anybody, and calling it a role would imply
            an authority this control does not have. */}
        <button
          onClick={() => setDesignerView((v) => !v)}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium hover:bg-white/15"
          style={{ background: "rgba(255,255,255,0.14)", color: "white" }}
          title={
            operator
              ? "Operator view — switch to Designer view to hide shop controls"
              : "Designer view — switch to Operator view to assign work and edit printers"
          }
          aria-pressed={designerView}
        >
          {operator ? <Settings size={13} /> : <Search size={13} />}
          {operator ? "Operator" : "Designer"}
        </button>
        {operator && (
          <button
            onClick={() => setShowShopSettings(true)}
            className="p-1.5 rounded hover:bg-white/15"
            title="Shop layout settings"
            aria-label="Shop layout settings"
            style={{ opacity: 0.55 }}
          >
            <Settings size={16} color="white" />
          </button>
        )}
      </header>

      {/* shop layout settings — a "set once" buried config */}
      {showShopSettings && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.4)" }}
          {...shopSettingsBackdrop}
        >
          <div
            className="rounded-xl shadow-2xl w-full max-w-md p-5"
            style={{ background: "white" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-1">
              <Settings size={16} style={{ color: "#5B5FC7" }} />
              <h2 className="text-base font-semibold" style={{ color: "#242424" }}>
                Shop layout
              </h2>
            </div>
            <p className="text-sm mb-4" style={{ color: "#605E5C" }}>
              Match the board to how your printers are physically arranged. This is
              usually set once when you configure the shop.
            </p>

            <div className="space-y-4">
              {[
                ["printersPerRow", "Printers per row, within a group", 8,
                  "e.g. a group of 4 printers shown 2-wide displays as a 2×2 block."],
                ["groupsPerRow", "Groups per row, across the board", 6,
                  "How many groups sit side by side before wrapping to the next row."],
              ].map(([key, label, max, hint]) => (
                <div key={key}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium" style={{ color: "#242424" }}>
                      {label}
                    </span>
                    <QuantityInput
                      value={appSettings[key]}
                      min={1}
                      max={max}
                      onChange={(v) => setAppSettings((s) => ({ ...s, [key]: v }))}
                    />
                  </div>
                  <p className="text-xs mt-1" style={{ color: "#8A8886" }}>
                    {hint}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex justify-between items-center mt-5">
              <button
                onClick={() =>
                  setAppSettings((s) => ({
                    ...s,
                    printersPerRow: DEFAULT_APP_SETTINGS.printersPerRow,
                    groupsPerRow: DEFAULT_APP_SETTINGS.groupsPerRow,
                  }))
                }
                className="text-xs font-medium px-2 py-1.5 rounded hover:bg-gray-100"
                style={{ color: "#605E5C" }}
              >
                Reset to default
              </button>
              <button
                onClick={() => setShowShopSettings(false)}
                className="text-sm font-medium px-4 py-1.5 rounded text-white"
                style={{ background: "#5B5FC7" }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- staging area ---------------- */}
      <StagingArea
        name={appSettings.stagingName}
        onRename={(n) =>
          n.trim() && setAppSettings((s) => ({ ...s, stagingName: n.trim() }))
        }
        tasks={stagingTasks}
        choices={choices}
        adding={addingTaskIn === STAGING}
        expandedTaskId={expandedTaskId}
        draggingTaskId={draggingTaskId}
        operator={operator}
        onStartAdd={() => setAddingTaskIn(STAGING)}
        onCancelAdd={() => setAddingTaskIn(null)}
        onAdd={(fields) => addTask(STAGING, fields)}
        onDropTask={(taskId) => moveTask(taskId, STAGING)}
        /* No onDropOnTask: staging order is fully computed (item 22), so
           dropping onto a specific card to reposition it would be a dead
           gesture. Dropping anywhere on the panel (onDropTask above) still
           moves a task into or out of staging. */
        onExpandTask={toggleExpand}
        onContextMenu={openTaskMenu}
        {...dragProps}
      />

      {/* ---------------- in-progress jobs (item 34) ----------------
          Jobs mid-production: at least one run on a printer, not yet
          complete. */}
      <InProgressPanel
        jobs={inProgressJobs}
        subtasksByParent={subtasksByParent}
        printers={printers}
        operator={operator}
        draggingTaskId={draggingTaskId}
        onExpandTask={toggleExpand}
        onContextMenu={openTaskMenu}
        {...dragProps}
      />

      {/* ---------------- jobcode filter ----------------
          Hidden entirely when nothing is assigned — an empty dropdown is
          clutter, not a feature. Purely visual: dimmed printers still accept
          drops and clicks, because a card that looks disabled and silently
          refuses work reads as a bug. */}
      {liveJobcodes.length > 0 && (
        <div
          className="mx-5 mt-3 mb-1 px-4 py-2.5 rounded-lg flex items-center gap-2 flex-wrap"
          style={{ background: "white", border: "1px solid #E1DFDD" }}
        >
          <span
            className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide"
            style={{ color: "#605E5C" }}
          >
            <Search size={14} style={{ color: "#605E5C" }} />
            Jobcode
          </span>
          <select
            value={jobcodeFilter}
            onChange={(e) => setJobcodeFilter(e.target.value)}
            className="text-xs px-2 py-1 rounded border bg-white outline-none"
            style={{ borderColor: jobcodeFilter ? ACCENT : "#C8C6C4", minWidth: 150 }}
            aria-label="Highlight printers by jobcode"
          >
            <option value="">All jobcodes</option>
            {liveJobcodes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {jobcodeFilter && (
            <>
              <span className="text-xs" style={{ color: "#605E5C" }}>
                {jobcodeMatches.size} printer{jobcodeMatches.size !== 1 && "s"}
              </span>
              <button
                onClick={() => setJobcodeFilter("")}
                className="text-xs font-medium underline"
                style={{ color: ACCENT }}
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}

      {/* ---------------- groups ---------------- */}
      <main className="px-5 py-3 pt-3 pp-board-scroll">
        <div
          className="grid items-start"
          style={{
            gridTemplateColumns: `repeat(${appSettings.groupsPerRow}, minmax(0, 1fr))`,
            gap: GROUP_GAP,
            minWidth: boardMinW(
              appSettings.printersPerRow,
              appSettings.groupsPerRow
            ),
          }}
        >
          {groups.map((group) => {
            const groupPrinters = printers.filter((p) => p.groupId === group.id);
            const isEditing = editingGroupId === group.id;
            return (
              <section
                key={group.id}
                className="rounded-lg overflow-hidden"
                style={{
                  background: "white",
                  border: "1px solid #E1DFDD",
                  /* neutral: the band still separates one group from the next,
                     it just no longer claims to identify which */
                  borderLeft: "4px solid #C8C6C4",
                }}
              >
                {/* group header */}
                <div
                  className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
                  onClick={() => !isEditing && toggleGroup(group.id)}
                >
                  {group.collapsed ? (
                    <ChevronRight size={16} style={{ color: "#605E5C" }} />
                  ) : (
                    <ChevronDown size={16} style={{ color: "#605E5C" }} />
                  )}
                  {isEditing ? (
                    <input
                      autoFocus
                      defaultValue={group.name}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => renameGroup(group.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.target.blur();
                        if (e.key === "Escape") setEditingGroupId(null);
                      }}
                      className="text-sm font-semibold px-2 py-0.5 rounded border outline-none"
                      style={{ borderColor: ACCENT, color: "#242424" }}
                      aria-label="Group name"
                    />
                  ) : (
                    <span className="font-semibold text-sm" style={{ color: "#242424" }}>
                      {group.name}
                    </span>
                  )}
                  {!isEditing && operator && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingGroupId(group.id);
                      }}
                      className="p-1 rounded hover:bg-gray-200"
                      title="Rename group"
                      aria-label={`Rename group ${group.name}`}
                    >
                      <Pencil size={12} style={{ color: "#8A8886" }} />
                    </button>
                  )}
                  {removeGroupMode && !isEditing && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        askDeleteGroup(group.id);
                      }}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium"
                      style={{ background: "#FDE7E9", color: "#D13438" }}
                      title={`Delete group ${group.name}`}
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  )}
                  <span className="text-xs" style={{ color: "#8A8886" }}>
                    {groupPrinters.length} printer{groupPrinters.length !== 1 && "s"}
                  </span>
                  {group.collapsed && (
                    <span className="flex gap-1 ml-1">
                      {groupPrinters.map((p) => (
                        <span
                          key={p.id}
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ background: PRINTER_STATUS[p.status]?.color }}
                          title={`${p.name} — ${p.status}`}
                        />
                      ))}
                    </span>
                  )}
                </div>

                {/* group body */}
                {!group.collapsed && (
                  <div
                    className="px-4 pb-4 pt-1 grid items-start"
                    style={{
                      background: "#FAFAFA",
                      gridTemplateColumns: `repeat(${appSettings.printersPerRow}, minmax(0, 1fr))`,
                      gap: PRINTER_GAP,
                    }}
                  >
                    {groupPrinters.map((printer) => (
                      <PrinterColumn
                        key={printer.id}
                        printer={printer}
                        filteredOut={!!jobcodeMatches && !jobcodeMatches.has(printer.id)}
                        tasks={tasksByPrinter[printer.id] || []}
                        choices={choices}
                        settingsOpen={!!openSettings[printer.id]}
                        addingTask={addingTaskIn === printer.id}
                        expandedTaskId={expandedTaskId}
                        draggingTaskId={draggingTaskId}
                        onToggleSettings={() =>
                          setOpenSettings((s) => ({
                            ...s,
                            [printer.id]: !s[printer.id],
                          }))
                        }
                        onUpdatePrinter={updatePrinter}
                        onSetStatus={setPrinterStatus}
                        onUpdateSettings={updatePrinterSettings}
                        onUpdateField={updatePrinterField}
                        onDeletePrinter={askDeletePrinter}
                        onStartAddTask={() => setAddingTaskIn(printer.id)}
                        onCancelAddTask={() => setAddingTaskIn(null)}
                        onAddTask={(fields) => addTask(printer.id, fields)}
                        onExpandTask={toggleExpand}
                        onDropTask={(taskId) => moveTask(taskId, printer.id)}
                        onDropOnTask={moveTaskRelative}
                        onTaskContextMenu={openTaskMenu}
                        onPrinterContextMenu={openPrinterMenu}
                        operator={operator}
                        editPrintersMode={editPrintersMode}
                        {...dragProps}
                      />
                    ))}

                    {/* Add printer only shows up inside Edit printers mode —
                        the big dashed button every group used to carry was
                        replaced with this compact tile, reached the same way
                        a printer gets removed. */}
                    {operator && editPrintersMode && (
                    <button
                      onClick={() => addPrinter(group.id)}
                      className="w-full mt-2 rounded-lg border-2 border-dashed flex items-center justify-center gap-1.5 py-3 text-xs font-medium hover:bg-white"
                      style={{ borderColor: "#C8C6C4", color: "#605E5C" }}
                      title={`Add printer to ${group.name}`}
                      aria-label={`Add printer to ${group.name}`}
                    >
                      <Plus size={14} /> Add
                    </button>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </main>

      {/* add group — outside the scrolling board so it stays at viewport width */}
      {operator && (
      <div className="px-5 pb-5">
        {showNewGroup ? (
          <div
            className="rounded-lg p-3 flex gap-2 items-center"
            style={{ background: "white", border: "1px solid #E1DFDD", maxWidth: 480 }}
          >
            <input
              autoFocus
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addGroup()}
              placeholder="Group name"
              className="flex-1 text-sm px-3 py-1.5 rounded border outline-none focus:ring-2"
              style={{ borderColor: "#C8C6C4" }}
            />
            <button
              onClick={addGroup}
              className="text-sm font-medium text-white px-3 py-1.5 rounded"
              style={{ background: "#5B5FC7" }}
            >
              Create group
            </button>
            <button
              onClick={() => setShowNewGroup(false)}
              className="p-1.5 rounded hover:bg-gray-100"
              aria-label="Cancel"
            >
              <X size={16} style={{ color: "#605E5C" }} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowNewGroup(true)}
              className="flex items-center gap-2 text-sm font-medium px-3 py-2 rounded hover:bg-white"
              style={{ color: "#5B5FC7" }}
            >
              <Plus size={16} /> Add group
            </button>
            {groups.length > 0 && (
              <button
                onClick={() => setRemoveGroupMode((v) => !v)}
                className="flex items-center gap-2 text-sm font-medium px-3 py-2 rounded hover:bg-white"
                style={{ color: removeGroupMode ? "#D13438" : "#605E5C" }}
                title="Delete a group"
              >
                <Trash2 size={15} />
                {removeGroupMode ? "Select a group to delete…" : "Remove group"}
              </button>
            )}
            <button
              onClick={() => setEditPrintersMode((v) => !v)}
              className="flex items-center gap-2 text-sm font-medium px-3 py-2 rounded hover:bg-white"
              style={{ color: editPrintersMode ? ACCENT : "#605E5C" }}
              title="Add or remove printers"
            >
              <Pencil size={15} />
              {editPrintersMode ? "Done editing printers" : "Edit printers"}
            </button>
          </div>
        )}
      </div>
      )}

      {/* ---------------- completed jobs (both views) ----------------
          The permanent, cross-printer record of finished work — sorted by
          completion, filterable by jobcode. Shown in both views: an operator
          and a designer have equal reason to look up what shipped, and it
          carries no control that either shouldn't have (it has no purge
          button in either view — see decisions.md). Read-only except for one
          action, in both views: right-click → Reprint job, which queues a
          fresh copy in staging and touches nothing in the record. */}
      <CompletedJobsPanel
        tasks={completedTasks}
        printers={printers}
        onContextMenu={openHistoryMenu}
      />

      {/* ---------------- task detail modal (single instance, app level) ----
          Kept out of TaskCard so it survives the card unmounting mid-edit —
          e.g. setting a job Complete removes it from the printer card. */}
      {expandedTask && (
        <TaskDetailModal
          task={expandedTask}
          inStaging={expandedTask.printerId === STAGING}
          printerStatus={
            printers.find((p) => p.id === expandedTask.printerId)?.status || "Ready"
          }
          choices={choices}
          readOnly={operator && expandedTask.printerId === STAGING}
          onUpdate={updateTask}
          onDelete={deleteTask}
          onCompleteReprint={completeAndReprint}
          onClose={() => setExpandedTaskId(null)}
        />
      )}

      {/* ---------------- destructive-action confirmation ---------------- */}
      {confirm && (
        <ConfirmDialog
          {...confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            confirm.onConfirm();
            setConfirm(null);
          }}
        />
      )}

      {/* ---------------- context menu ---------------- */}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          tasks={tasks}
          printers={printers}
          groups={groups}
          stagingName={appSettings.stagingName}
          acceptsTasks={acceptsTasks}
          operator={operator}
          onClose={() => setContextMenu(null)}
          onUpdateTask={updateTask}
          onDeleteTask={deleteTask}
          onCompleteReprint={completeAndReprint}
          onMoveTask={moveTask}
          onCopyTask={copyTask}
          onReprintTask={reprintTask}
          onSetStatus={setPrinterStatus}
          onDeletePrinter={askDeletePrinter}
          onExpandTask={(id) => setExpandedTaskId(id)}
        />
      )}
    </div>
  );
}

/* ------------------------- confirmation dialog ------------------------ */

function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel }) {
  const backdrop = useBackdropClose(onCancel);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }}
      {...backdrop}
    >
      <div
        className="rounded-xl shadow-2xl w-full max-w-md p-5"
        style={{ background: "white" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-2">
          <span
            className="flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0"
            style={{ background: "#FDE7E9" }}
          >
            <Trash2 size={16} style={{ color: "#D13438" }} />
          </span>
          <h2 className="text-base font-semibold" style={{ color: "#242424" }}>
            {title}
          </h2>
        </div>
        <div className="mb-4">{body}</div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-sm font-medium px-3 py-1.5 rounded border hover:bg-gray-50"
            style={{ borderColor: "#C8C6C4", color: "#605E5C" }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded text-white"
            style={{ background: "#D13438" }}
          >
            <Trash2 size={14} /> {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- context menu ----------------------------- */

function ContextMenu({
  menu,
  operator,
  tasks,
  printers,
  groups,
  stagingName,
  acceptsTasks,
  onClose,
  onUpdateTask,
  onDeleteTask,
  onMoveTask,
  onCopyTask,
  onReprintTask,
  onCompleteReprint,
  onSetStatus,
  onDeletePrinter,
  onExpandTask,
}) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });

  useEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - 8),
      y: Math.min(menu.y, window.innerHeight - r.height - 8),
    });
  }, [menu]);

  const Item = ({ icon, label, onClick, danger, swatch, disabled, title }) => (
    <button
      disabled={disabled}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        onClick();
        onClose();
      }}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm ${
        disabled ? "cursor-not-allowed" : "hover:bg-gray-100"
      }`}
      style={{
        color: disabled ? "#A19F9D" : danger ? "#D13438" : "#242424",
      }}
    >
      {swatch && (
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: swatch }} />
      )}
      {icon}
      {label}
    </button>
  );

  const Divider = () => (
    <div className="my-1 border-t" style={{ borderColor: "#EDEBE9" }} />
  );

  const Header = ({ children }) => (
    <div
      className="px-3 pt-1.5 pb-0.5 text-xs font-semibold uppercase tracking-wide"
      style={{ color: "#8A8886" }}
    >
      {children}
    </div>
  );

  let content = null;

  if (menu.type === "task") {
    const task = tasks.find((t) => t.id === menu.id);
    if (!task) return null;
    /* item 35 vocabulary: a row with a parent is a run, anything else a job */
    const noun = task.parentId ? "run" : "job";
    /* only Ready printers can take work */
    const destinations = printers.filter(
      (p) => acceptsTasks(p.id) && p.id !== task.printerId
    );
    const printerStatus =
      printers.find((p) => p.id === task.printerId)?.status || "Ready";
    const startable = canStartWork(printerStatus);
    content = (
      <>
        {task.printerId !== STAGING && (
          <>
            <Header>Set status</Header>
            {STATUSES.map((s) => {
              /* A held or out-of-service machine cannot have work started on
                 it. Shown greyed with the reason rather than hidden — an
                 option that vanishes leaves you wondering, and one that
                 accepts a click and does nothing reads as a bug. */
              const blocked = s === "In progress" && !startable;
              return (
                <Item
                  key={s}
                  swatch={STATUS_STYLE[s].dot}
                  disabled={blocked}
                  title={
                    blocked
                      ? `${printerStatus} — a job cannot be started on this printer`
                      : undefined
                  }
                  label={
                    <span className="flex-1 flex items-center justify-between">
                      {s}
                      {task.status === s && (
                        <Check size={13} style={{ color: "#5B5FC7" }} />
                      )}
                    </span>
                  }
                  onClick={() => onUpdateTask(task.id, { status: s })}
                />
              );
            })}
            {/* An action, not a state: completes this run and queues its
                successor with the quantity open in the editor (item 33).
                Greyed once Complete — there is nothing left to complete, and
                plain Duplicate below covers the copy. */}
            <Item
              icon={<Copy size={14} style={{ color: "#605E5C" }} />}
              disabled={task.status === "Complete"}
              title={
                task.status === "Complete"
                  ? `Already complete — use Duplicate ${noun} instead`
                  : "Complete this run and queue a reprint; the editor opens to set its quantity"
              }
              label="Complete & reprint"
              onClick={() => onCompleteReprint(task.id)}
            />
            <Divider />
          </>
        )}
        <Header>Slicing</Header>
        {TASK_TAGS.map((tag) => (
          <Item
            key={tag}
            swatch={SLICE_DOT[tag]}
            label={
              <span className="flex-1 flex items-center justify-between">
                {tag}
                {task.sliceStatus === tag && (
                  <Check size={13} style={{ color: "#5B5FC7" }} />
                )}
              </span>
            }
            onClick={() => onUpdateTask(task.id, { sliceStatus: tag })}
          />
        ))}
        {operator && (
          <>
            <Divider />
            <Header>Move to</Header>
        {/* runs never sit in staging (moveTask refuses them) — offering the
            item would be a click that does nothing */}
        {task.printerId !== STAGING && !task.parentId && (
          <Item
            icon={<Inbox size={14} style={{ color: "#605E5C" }} />}
            label={stagingName || "Staging area"}
            onClick={() => onMoveTask(task.id, STAGING)}
          />
        )}
        {destinations.map((p) => {
          const g = groups.find((g) => g.id === p.groupId);
          return (
            <Item
              key={p.id}
              label={
                <span className="flex-1">
                  {p.name}
                  <span className="text-xs ml-1" style={{ color: "#8A8886" }}>
                    · {g?.name}
                  </span>
                </span>
              }
              onClick={() => onMoveTask(task.id, p.id)}
            />
          );
        })}
            {destinations.length === 0 && task.printerId === STAGING && (
              <div className="px-3 py-1 text-xs italic" style={{ color: "#8A8886" }}>
                No printers are Ready
              </div>
            )}
          </>
        )}
        <Divider />
        <Item
          icon={<Pencil size={14} style={{ color: "#605E5C" }} />}
          label="Edit details"
          onClick={() => onExpandTask(task.id)}
        />
        <Item
          icon={<Copy size={14} style={{ color: "#605E5C" }} />}
          label={`Duplicate ${noun}`}
          onClick={() => onCopyTask(task.id)}
        />
        <Item
          icon={<Trash2 size={14} />}
          label={`Delete ${noun}`}
          danger
          onClick={() => onDeleteTask(task.id)}
        />
      </>
    );
  }

  /* a completed row's one action: recall it to staging as a fresh job.
     Available in both views — a designer re-raising finished work is the
     whole point of the record. */
  if (menu.type === "history") {
    const task = tasks.find((t) => t.id === menu.id);
    if (!task) return null;
    content = (
      <>
        <Header>{task.title}</Header>
        <Item
          icon={<Copy size={14} style={{ color: "#605E5C" }} />}
          label="Reprint job"
          title="Queue a fresh copy of this job in the staging area"
          onClick={() => onReprintTask(task.id)}
        />
      </>
    );
  }

  if (menu.type === "printer") {
    const printer = printers.find((p) => p.id === menu.id);
    if (!printer) return null;
    content = (
      <>
        <Header>{printer.name}</Header>
        {PRINTER_STATUSES.map((s) => (
          <Item
            key={s}
            swatch={PRINTER_STATUS[s].color}
            label={
              <span className="flex-1 min-w-0">
                <span className="flex items-center justify-between">
                  {s}
                  {printer.status === s && (
                    <Check size={13} style={{ color: "#5B5FC7" }} />
                  )}
                </span>
                <span className="block text-xs" style={{ color: "#8A8886" }}>
                  {PRINTER_STATUS[s].blurb}
                </span>
              </span>
            }
            onClick={() => onSetStatus(printer.id, s)}
          />
        ))}
        <Divider />
        <Item
          icon={<Trash2 size={14} />}
          label="Delete printer"
          danger
          onClick={() => onDeletePrinter(printer.id)}
        />
      </>
    );
  }

  return (
    <div
      ref={ref}
      className="fixed z-50 w-64 py-1.5 rounded-lg shadow-xl"
      style={{
        top: pos.y,
        left: pos.x,
        background: "white",
        border: "1px solid #E1DFDD",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {content}
    </div>
  );
}

/* --------------------------- staging area ----------------------------- */

const PRIORITY_RANK = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
const STAGING_PAGE = 60; // cap initial render; more loads as you scroll

/* Scroll paging shared by staging and the history table: render `limit`
   rows; nearing the bottom loads one batch per wheel flick — loadingRef
   re-arms only after the new batch has rendered, so a long scroll event
   stream can't burn through the whole list in one gesture. */
function usePaged(pageSize) {
  const [limit, setLimit] = useState(pageSize);
  const scrollRef = useRef(null);
  const loadingRef = useRef(false);
  useEffect(() => {
    loadingRef.current = false;
  }, [limit]);
  const loadMore = () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLimit((l) => l + pageSize);
  };
  const onScrollFor = (hidden) => () => {
    const el = scrollRef.current;
    if (!el || hidden <= 0) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) loadMore();
  };
  return { limit, setLimit, scrollRef, loadMore, onScrollFor };
}

/* Staging's 2nd/3rd sort keys, both ascending with undated/unstamped last —
   a job with no deadline or no recorded creation time shouldn't jump ahead
   of one that has either. Infinity sorts after any real timestamp, and an
   unparseable value counts as absent rather than yielding NaN: NaN survives
   every comparison below and would make the comparator itself inconsistent. */
const timeKey = (v) => {
  if (!v) return Infinity;
  const t = Date.parse(v);
  return Number.isNaN(t) ? Infinity : t;
};
/* A date-only "YYYY-MM-DD" parses as UTC midnight, which is fine: every
   need-by is read the same way, so the comparison is offset-free. */
const needByKey = (t) => timeKey(t.needByDate);
const createdKey = (t) => timeKey(t.createdAt);

/* The queue order both work panels share: priority tier, then need-by
   (soonest first), then created-at (oldest first). Callers sort a copy;
   Array.prototype.sort is stable, so equal keys keep their incoming order
   without a decorate/undecorate dance. */
const byQueueOrder = (a, b) => {
  const pa = PRIORITY_RANK[a.priority || "Normal"];
  const pb = PRIORITY_RANK[b.priority || "Normal"];
  if (pa !== pb) return pa - pb;
  const na = needByKey(a);
  const nb = needByKey(b);
  if (na !== nb) return na - nb;
  return createdKey(a) - createdKey(b);
};

/* the printer-id → name lookup both panels build */
const printerNamesOf = (printers) =>
  Object.fromEntries(printers.map((p) => [p.id, p.name]));

function StagingArea({
  name,
  onRename,
  tasks,
  choices,
  adding,
  expandedTaskId,
  draggingTaskId,
  operator,
  onStartAdd,
  onCancelAdd,
  onAdd,
  onDropTask,
  onExpandTask,
  onContextMenu,
  onDragStart,
  onDragEnd,
}) {
  const [dragOver, setDragOver] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const { limit, scrollRef, loadMore, onScrollFor } = usePaged(STAGING_PAGE);
  const showDrop = dragOver && !!draggingTaskId;

  /* filter → then sort: priority tier, then need-by, then created-at */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (priorityFilter !== "All" && (t.priority || "Normal") !== priorityFilter)
        return false;
      if (!q) return true;
      return (
        (t.title || "").toLowerCase().includes(q) ||
        (t.jobcode || "").toLowerCase().includes(q) ||
        (t.sentBy || "").toLowerCase().includes(q) ||
        (t.giveTo || "").toLowerCase().includes(q) ||
        (t.filepath || "").toLowerCase().includes(q)
      );
    });
  }, [tasks, query, priorityFilter]);

  /* Within a priority tier, order is fully computed — see byQueueOrder —
     rather than manual drag order. */
  const sorted = useMemo(() => [...filtered].sort(byQueueOrder), [filtered]);

  /* tier counts once per change, rather than a filter per header row */
  const tierCounts = useMemo(() => {
    const c = {};
    sorted.forEach((t) => {
      const k = t.priority || "Normal";
      c[k] = (c[k] || 0) + 1;
    });
    return c;
  }, [sorted]);

  const visible = sorted.slice(0, limit);
  const hidden = sorted.length - visible.length;
  const onScroll = onScrollFor(hidden);

  /* tier boundaries: show a small header the first time each tier appears */
  let lastTier = null;

  return (
    <div
      className="mx-5 mt-3 rounded-lg transition-colors"
      style={{
        background: showDrop ? "#EEF1FB" : "white",
        border: showDrop ? "2px dashed #5B5FC7" : "2px dashed #C8C6C4",
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDropTask(id);
        setDragOver(false);
      }}
    >
      {/* header row */}
      <div className="px-4 py-2 flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="p-0.5 rounded hover:bg-gray-100"
          aria-label={collapsed ? "Expand staging" : "Collapse staging"}
        >
          {collapsed ? (
            <ChevronRight size={15} style={{ color: "#605E5C" }} />
          ) : (
            <ChevronDown size={15} style={{ color: "#605E5C" }} />
          )}
        </button>
        <Inbox size={16} style={{ color: "#5B5FC7" }} />
        {editingName ? (
          <input
            autoFocus
            defaultValue={name}
            onBlur={(e) => {
              onRename(e.target.value);
              setEditingName(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.target.blur();
              if (e.key === "Escape") setEditingName(false);
            }}
            className="text-sm font-semibold px-2 py-0.5 rounded border outline-none"
            style={{ borderColor: "#5B5FC7", color: "#242424" }}
            aria-label="Staging area name"
          />
        ) : (
          <>
            <span className="text-sm font-semibold" style={{ color: "#242424" }}>
              {name}
            </span>
            {/* Operator only. The staging name is shared shop configuration —
                it lives in the Settings list, so renaming it renames it for
                everyone — which is the same reason designer view hides the
                shop-layout gear and the group rename pencil. */}
            {operator && (
              <button
                onClick={() => setEditingName(true)}
                className="p-1 rounded hover:bg-gray-200"
                title="Rename staging area"
                aria-label="Rename staging area"
              >
                <Pencil size={12} style={{ color: "#8A8886" }} />
              </button>
            )}
          </>
        )}
        <span
          className="px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0"
          style={{ background: "#EEF1FB", color: "#5B5FC7", fontSize: 11 }}
        >
          {tasks.length}
        </span>

        {/* search + filter appear once the pile is non-trivial */}
        {tasks.length > 8 && !collapsed && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search
                size={12}
                style={{ color: "#8A8886", position: "absolute", left: 7, top: 8 }}
              />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(STAGING_PAGE);
                }}
                placeholder="Search parts…"
                className="text-xs rounded border outline-none focus:ring-1"
                style={{ borderColor: "#C8C6C4", height: 26, paddingLeft: 22, paddingRight: 8, width: 150 }}
                aria-label="Search staging"
              />
            </div>
            <select
              value={priorityFilter}
              onChange={(e) => {
                setPriorityFilter(e.target.value);
                setLimit(STAGING_PAGE);
              }}
              className="text-xs rounded border bg-white outline-none"
              style={{ borderColor: "#C8C6C4", height: 26 }}
              aria-label="Filter by priority"
            >
              <option>All</option>
              {PRIORITIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
        )}

        <button
          onClick={onStartAdd}
          className="ml-auto flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg text-white flex-shrink-0"
          style={{ background: "#5B5FC7" }}
        >
          <Plus size={14} /> New job
        </button>
      </div>

      {!collapsed && (tasks.length > 0 || adding) && (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="px-4 pb-3 overflow-y-auto"
          style={{ maxHeight: 320 }}
        >
          {adding && (
            <div className="mb-3" style={{ maxWidth: 288 }}>
              <AddTaskForm
                choices={choices}
                showEta={false}
                onAdd={onAdd}
                onCancel={onCancelAdd}
              />
            </div>
          )}

          {sorted.length === 0 ? (
            <div
              className="text-xs italic py-6 text-center"
              style={{ color: "#8A8886" }}
            >
              {query || priorityFilter !== "All"
                ? "No parts match your search."
                : "Nothing in staging yet."}
            </div>
          ) : (
            <div
              className="grid gap-2 items-start"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(232px, 1fr))",
              }}
            >
              {visible.map((task) => {
                const tier = task.priority || "Normal";
                const showHeader = tier !== lastTier;
                lastTier = tier;
                return (
                  <React.Fragment key={task.id}>
                    {showHeader && (
                      <div
                        className="flex items-center gap-1.5 pt-1 pb-0.5"
                        style={{ gridColumn: "1 / -1" }}
                      >
                        <Flag size={11} style={{ color: PRIORITY_STYLE[tier]?.text }} />
                        <span
                          className="text-xs font-semibold uppercase tracking-wide"
                          style={{ color: PRIORITY_STYLE[tier]?.text }}
                        >
                          {tier} priority
                        </span>
                        <span className="text-xs" style={{ color: "#C8C6C4" }}>
                          {tierCounts[tier]}
                        </span>
                        <div
                          className="flex-1 h-px ml-1"
                          style={{ background: "#EDEBE9" }}
                        />
                      </div>
                    )}
                    <TaskCard
                      task={task}
                      /* designers can't drop anywhere (every printer's onDrop
                         requires operator), so don't let them pick cards up */
                      draggableCard={operator}
                      expanded={expandedTaskId === task.id}
                      onExpand={() => onExpandTask(task.id)}
                      onContextMenu={onContextMenu}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                      inStaging
                      dragging={draggingTaskId === task.id}
                      operator={operator}
                    />
                  </React.Fragment>
                );
              })}
              {hidden > 0 && (
                <button
                  onClick={loadMore}
                  className="flex items-center justify-center gap-1.5 text-xs py-2 rounded hover:bg-gray-50"
                  style={{ gridColumn: "1 / -1", color: "#8A8886" }}
                  title="Loads automatically as you scroll — click to load now"
                >
                  <ChevronDown size={12} />
                  Load {Math.min(hidden, STAGING_PAGE)} more ({hidden} remaining)
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------ in-progress jobs panel ----------------------- */

/* Jobs with at least one run on a printer (item 34). Same chrome and sort as
   staging — priority tier, then need-by, then created-at — but no search,
   paging, or tier headers: this block holds what the shop is actively
   producing, which is bounded by printers, not by the backlog. The card is
   the approved three-row face (title + remaining pill / jobcode / need-by;
   no ETA, since a job spanning printers has no single one), plus an
   expandable list of its runs. Interaction mirrors staging's view split:
   designers click into the job and get its context menu, operators drag it
   to a printer to assign another run. */
function InProgressPanel({
  jobs,
  subtasksByParent,
  printers,
  operator,
  draggingTaskId,
  onExpandTask,
  onContextMenu,
  onDragStart,
  onDragEnd,
}) {
  const [openJobs, setOpenJobs] = useState({}); // jobId → runs list expanded

  const printerName = useMemo(() => printerNamesOf(printers), [printers]);

  const sorted = useMemo(() => [...jobs].sort(byQueueOrder), [jobs]);

  return (
    <div
      className="mx-5 mt-3 rounded-lg"
      style={{ background: "white", border: "1px solid #E1DFDD" }}
    >
      <div className="px-4 py-2 flex items-center gap-2">
        <Activity size={16} style={{ color: ACCENT }} />
        <span className="text-sm font-semibold" style={{ color: "#242424" }}>
          In progress
        </span>
        <span
          className="px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0"
          style={{ background: "#EEF1FB", color: ACCENT, fontSize: 11 }}
        >
          {jobs.length}
        </span>
      </div>

      <div className="px-4 pb-3">
        {jobs.length === 0 ? (
          /* the block used to hide when empty, which read as the feature
             being missing — it stays put now, stating its own empty case */
          <div className="text-xs italic" style={{ color: "#8A8886" }}>
            Nothing in progress — assign a staging job to a printer.
          </div>
        ) : (
        <div
          className="grid gap-2 items-start"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(232px, 1fr))" }}
        >
          {sorted.map((job) => {
            const subs = subtasksByParent[job.id] || [];
            const total = Number(job.quantity) || 1;
            const assigned = subs.reduce(
              (n, s) => n + (Number(s.quantity) || 0),
              0
            );
            const remaining = Math.max(total - assigned, 0);
            const needBy = formatEta(job.needByDate, "");
            const open = !!openJobs[job.id];
            return (
              <div
                key={job.id}
                draggable={operator}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", job.id);
                  e.dataTransfer.effectAllowed = "move";
                  /* defer, so the browser captures the drag image before the
                     card re-renders at reduced opacity — same trap TaskCard
                     documents */
                  if (onDragStart) setTimeout(() => onDragStart(job.id), 0);
                }}
                onDragEnd={() => onDragEnd && onDragEnd()}
                onContextMenu={(e) => !operator && onContextMenu(e, job.id)}
                className="rounded-lg border"
                style={{
                  borderColor: "#E1DFDD",
                  background: "white",
                  opacity: draggingTaskId === job.id ? 0.4 : 1,
                  cursor: operator ? "grab" : "default",
                }}
              >
                <button
                  onClick={() => !operator && onExpandTask(job.id)}
                  disabled={operator}
                  className="w-full text-left px-2.5 pt-2 pb-1"
                  title={
                    operator
                      ? "Drag to a printer to assign another run"
                      : "Click for details · right-click for menu"
                  }
                >
                  {/* Row 1: job name · remaining. The pill is the card's whole
                      reason to exist — what is left to put on a printer. */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="flex-1 min-w-0 text-sm leading-snug truncate"
                      title={job.title}
                      style={{ color: "#242424" }}
                    >
                      {job.title}
                    </span>
                    {job.priority && job.priority !== "Normal" && (
                      <Flag
                        size={11}
                        className="flex-shrink-0"
                        style={{ color: PRIORITY_STYLE[job.priority]?.text }}
                        title={`Priority: ${job.priority}`}
                      />
                    )}
                    <span
                      className="px-1.5 rounded font-medium flex-shrink-0"
                      style={{
                        background: "#EEF1FB",
                        color: ACCENT,
                        fontSize: 10,
                        lineHeight: "15px",
                      }}
                      title={`${assigned} of ${total} assigned to printers`}
                    >
                      {remaining} of {total} left
                    </span>
                  </div>

                  {/* Row 2: jobcode, indented — same reading as TaskCard's */}
                  {job.jobcode && (
                    <div
                      className="mt-0.5 tabular-nums truncate"
                      style={{ paddingLeft: 12, color: "#605E5C", fontSize: 10 }}
                      title={`Jobcode: ${job.jobcode}`}
                    >
                      {job.jobcode}
                    </div>
                  )}

                  {/* Row 3: need-by. Back on this card type deliberately —
                      the deadline is what drives assigning the rest. */}
                  {needBy && (
                    <div className="mt-1" style={{ fontSize: 10, color: "#605E5C" }}>
                      Need by {needBy.date}
                    </div>
                  )}
                </button>

                {/* the job's runs, one line each */}
                <button
                  onClick={() =>
                    setOpenJobs((s) => ({ ...s, [job.id]: !s[job.id] }))
                  }
                  className="w-full flex items-center gap-1 px-2.5 py-1 text-xs hover:bg-gray-50"
                  style={{ color: "#8A8886" }}
                  aria-expanded={open}
                >
                  {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {subs.length} run{subs.length !== 1 ? "s" : ""}
                </button>
                {open && (
                  <div
                    className="px-2.5 pb-2 space-y-1"
                    style={{ background: "#FAFAFA" }}
                  >
                    {subs.map((s) => {
                      const st = STATUS_STYLE[s.status] || STATUS_STYLE["Not started"];
                      return (
                        <div
                          key={s.id}
                          className="flex items-center gap-1.5 pt-1"
                          style={{ fontSize: 11 }}
                        >
                          <span
                            className="flex-1 min-w-0 truncate"
                            style={{ color: "#605E5C" }}
                            title={`${s.title} on ${printerName[s.printerId] || "—"}`}
                          >
                            {s.title} · {printerName[s.printerId] || "—"}
                          </span>
                          <span
                            className="tabular-nums flex-shrink-0"
                            style={{ color: "#8A8886", fontSize: 10 }}
                          >
                            Qty {Number(s.quantity) || 1}
                          </span>
                          <span
                            className="px-1.5 rounded font-medium flex-shrink-0"
                            style={{
                              background: st.bg,
                              color: st.text,
                              fontSize: 10,
                              lineHeight: "15px",
                            }}
                          >
                            {s.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------- completed jobs panel -------------------------- */

const COMPLETED_PAGE = 60; // same batching pattern as staging

/* Most-recent-first. Missing/unparseable completedAt sorts last regardless
   of direction — same principle as staging's timeKey, kept separate here
   since the ordering itself is reversed (newest first, not soonest first). */
const completedAtKey = (t) => {
  const v = timeKey(t.completedAt);
  return v === Infinity ? null : v;
};

function CompletedJobsPanel({ tasks, printers, onContextMenu }) {
  /* fold state is per browser like the view toggle; collapsed by default */
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("pfs.historyCollapsed") !== "expanded";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("pfs.historyCollapsed", collapsed ? "collapsed" : "expanded");
    } catch {
      /* not remembering the fold is survivable */
    }
  }, [collapsed]);
  const [expanded, setExpanded] = useState({}); // jobId → its runs shown
  const [jobcodeFilter, setJobcodeFilter] = useState(""); // "" = show everything
  const [printerFilter, setPrinterFilter] = useState(""); // "" = every printer
  const { limit, setLimit, scrollRef, loadMore, onScrollFor } = usePaged(COMPLETED_PAGE);

  const printerName = useMemo(() => printerNamesOf(printers), [printers]);

  /* Every jobcode that has ever completed, distinct and sorted. Built from the
     record itself, not the live board's liveJobcodes — this table outlives the
     work, so a code whose last job finished months ago must still be selectable
     here even though nothing on a printer carries it any more. */
  const jobcodes = useMemo(
    () => [...new Set(tasks.map((t) => t.jobcode).filter(Boolean))].sort(),
    [tasks]
  );

  /* Printers that have completed work, by the same record-not-live-board rule
     as the jobcode list. A deleted printer's tasks go back to staging, whose
     id has no name here — so an option is only offered while its name can be
     shown, and a selection is dropped if its printer goes away. */
  const printerOptions = useMemo(() => {
    const ids = new Set();
    tasks.forEach((t) => {
      if (printerName[t.printerId]) ids.add(t.printerId);
    });
    return Array.from(ids).sort((a, b) =>
      printerName[a].localeCompare(printerName[b])
    );
  }, [tasks, printerName]);

  useEffect(() => {
    if (printerFilter && !printerName[printerFilter]) setPrinterFilter("");
  }, [printerFilter, printerName]);

  /* Runs nest under their parent job's row when that job is itself in the
     table; the primary rows are jobs, legacy tasks, and runs whose parent is
     still live or deleted — those stay top-level so no completed work ever
     becomes unreachable behind a parent that isn't here. */
  const { primaries, childrenOf } = useMemo(() => {
    const ids = new Set(tasks.map((t) => t.id));
    const childrenOf = {};
    const primaries = [];
    tasks.forEach((t) => {
      if (t.parentId && ids.has(t.parentId)) {
        (childrenOf[t.parentId] ||= []).push(t);
      } else {
        primaries.push(t);
      }
    });
    /* runs read in the order they finished — chronological, missing last */
    Object.values(childrenOf).forEach((runs) =>
      runs.sort(
        (a, b) =>
          (completedAtKey(a) ?? Infinity) - (completedAtKey(b) ?? Infinity)
      )
    );
    return { primaries, childrenOf };
  }, [tasks]);

  const sorted = useMemo(
    () =>
      /* sort is stable, so unstamped rows keep their incoming order */
      [...primaries].sort((a, b) => {
        const ka = completedAtKey(a);
        const kb = completedAtKey(b);
        if (ka === null) return kb === null ? 0 : 1;
        if (kb === null) return -1;
        return kb - ka;
      }),
    [primaries]
  );

  // Filter after sorting, before pagination, so "load more" pages the matches
  // rather than paging the full list and hiding most of a page. The two
  // filters compose: both set means both must match. Filters match the whole
  // group: a job row stays when any of its runs matches (a job's row carries
  // no printer of its own, so the printer filter would otherwise never show
  // finished jobs), and an expanded job shows all its runs, not just matches.
  const filtered = useMemo(() => {
    const matches = (t) =>
      (!jobcodeFilter || t.jobcode === jobcodeFilter) &&
      (!printerFilter || t.printerId === printerFilter);
    return sorted.filter(
      (t) => matches(t) || (childrenOf[t.id] || []).some(matches)
    );
  }, [sorted, childrenOf, jobcodeFilter, printerFilter]);

  const visible = filtered.slice(0, limit);
  const hidden = filtered.length - visible.length;
  const onScroll = onScrollFor(hidden);

  // A filter change resets paging: otherwise a deep scroll into one code leaves
  // a short match list scrolled past its own end.
  useEffect(() => {
    setLimit(COMPLETED_PAGE);
  }, [jobcodeFilter, printerFilter]);

  /* One renderer for both row kinds. A primary row with runs toggles them on
     click; a child row indents its printer cell to sit under the chevron.
     Rows without runs get a chevron-width spacer so the columns line up. */
  const renderRow = (task, { child, runCount, open } = {}) => {
    const needBy = formatEta(task.needByDate, "");
    const completed = formatTimestamp(task.completedAt);
    const operatorNote = (task.operatorNotes || "").trim();
    const expandable = !child && runCount > 0;
    return (
      <tr
        key={task.id}
        onClick={
          expandable
            ? () => setExpanded((s) => ({ ...s, [task.id]: !s[task.id] }))
            : undefined
        }
        onContextMenu={(e) => onContextMenu(e, task.id)}
        title={
          expandable
            ? `${open ? "Hide" : "Show"} ${runCount} run${
                runCount !== 1 ? "s" : ""
              } · right-click to reprint`
            : "Right-click to reprint"
        }
        style={{
          borderBottom: "1px solid #F3F2F1",
          background: child ? "#FAFAFA" : undefined,
          cursor: expandable ? "pointer" : undefined,
        }}
      >
        <td
          className="px-3 py-1.5"
          style={{ color: "#605E5C", paddingLeft: child ? 28 : undefined }}
        >
          <span className="inline-flex items-center gap-1">
            {!child &&
              (expandable ? (
                open ? (
                  <ChevronDown size={12} className="flex-shrink-0" />
                ) : (
                  <ChevronRight size={12} className="flex-shrink-0" />
                )
              ) : (
                <span className="flex-shrink-0" style={{ width: 12 }} />
              ))}
            {printerName[task.printerId] || "—"}
          </span>
        </td>
        <td className="px-3 py-1.5 tabular-nums" style={{ color: "#605E5C" }}>
          {task.jobcode || ""}
        </td>
        <td
          className="px-3 py-1.5"
          style={{ color: "#242424", textDecoration: "line-through" }}
        >
          {task.title}
        </td>
        <td className="px-3 py-1.5 tabular-nums" style={{ color: "#605E5C" }}>
          {task.quantity || 1}
        </td>
        <td className="px-3 py-1.5">
          <span style={{ color: PRIORITY_STYLE[task.priority || "Normal"]?.text }}>
            {task.priority || "Normal"}
          </span>
        </td>
        <td className="px-3 py-1.5 tabular-nums" style={{ color: "#605E5C" }}>
          {needBy ? needBy.date : ""}
        </td>
        <td className="px-3 py-1.5 tabular-nums" style={{ color: "#605E5C" }}>
          {completed || ""}
        </td>
        <td className="px-3 py-1.5">
          {operatorNote && (
            <span title={`Operator notes: ${operatorNote}`}>
              <StickyNote size={11} style={{ color: "#8A8886" }} />
            </span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div
      className="mx-5 mt-3 mb-3 rounded-lg overflow-hidden"
      style={{ background: "white", border: "1px solid #E1DFDD" }}
    >
      {/* Header first, and the whole thing an ordinary block in the page
          flow — it reads as one of the board's sections (staging, jobcode
          filter, groups) rather than the viewport-anchored bar it started
          as. overflow-hidden keeps the sticky table head inside the
          rounded corners. */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-gray-50"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand completed jobs" : "Collapse completed jobs"}
      >
        {collapsed ? (
          <ChevronRight size={15} style={{ color: "#605E5C" }} />
        ) : (
          <ChevronDown size={15} style={{ color: "#605E5C" }} />
        )}
        <CheckCircle2 size={15} style={{ color: "#498205" }} />
        <span className="text-sm font-semibold" style={{ color: "#242424" }}>
          Completed jobs
        </span>
        <span
          className="px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0"
          style={{ background: "#DFF6DD", color: "#498205", fontSize: 11 }}
          title="Finished jobs — expand a row to see its runs"
        >
          {primaries.length}
        </span>
      </button>

      {/* Filters — outside the scroll area so they stay put while the table
          scrolls under them. Same visual pattern as the board's main jobcode
          filter strip. Each dropdown hides when it has nothing to offer: an
          empty dropdown is clutter, not a feature. */}
      {!collapsed && (jobcodes.length > 0 || printerOptions.length > 0) && (
        <div
          className="px-4 py-2 flex items-center gap-2 flex-wrap"
          style={{ background: "#FAFAF9", borderTop: "1px solid #EDEBE9" }}
        >
          <span
            className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide"
            style={{ color: "#605E5C" }}
          >
            <Search size={14} style={{ color: "#605E5C" }} />
            Filter
          </span>
          {jobcodes.length > 0 && (
            <select
              value={jobcodeFilter}
              onChange={(e) => setJobcodeFilter(e.target.value)}
              className="text-xs px-2 py-1 rounded border bg-white outline-none"
              style={{ borderColor: jobcodeFilter ? ACCENT : "#C8C6C4", minWidth: 150 }}
              aria-label="Filter completed jobs by jobcode"
            >
              <option value="">All jobcodes</option>
              {jobcodes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          {printerOptions.length > 0 && (
            <select
              value={printerFilter}
              onChange={(e) => setPrinterFilter(e.target.value)}
              className="text-xs px-2 py-1 rounded border bg-white outline-none"
              style={{ borderColor: printerFilter ? ACCENT : "#C8C6C4", minWidth: 150 }}
              aria-label="Filter completed jobs by printer"
            >
              <option value="">All printers</option>
              {printerOptions.map((id) => (
                <option key={id} value={id}>
                  {printerName[id]}
                </option>
              ))}
            </select>
          )}
          {(jobcodeFilter || printerFilter) && (
            <>
              <span className="text-xs" style={{ color: "#605E5C" }}>
                {filtered.length} job{filtered.length !== 1 && "s"}
              </span>
              <button
                onClick={() => {
                  setJobcodeFilter("");
                  setPrinterFilter("");
                }}
                className="text-xs font-medium underline"
                style={{ color: ACCENT }}
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}

      {!collapsed && (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="overflow-y-auto"
          style={{ maxHeight: 260, borderTop: "1px solid #EDEBE9" }}
        >
          {filtered.length === 0 ? (
            <div
              className="text-xs italic py-6 text-center"
              style={{ color: "#8A8886" }}
            >
              {jobcodeFilter || printerFilter
                ? "No completed jobs match the filter."
                : "No completed jobs yet."}
            </div>
          ) : (
            <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#FAFAF9",
                    color: "#605E5C",
                  }}
                >
                  {["Printer", "Jobcode", "Job", "Qty", "Priority", "Need by", "Completed", "Notes"].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-left font-semibold uppercase tracking-wide px-3 py-1.5"
                        style={{ fontSize: 10, borderBottom: "1px solid #E1DFDD" }}
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {visible.map((job) => {
                  const runs = childrenOf[job.id] || [];
                  const open = !!expanded[job.id];
                  return (
                    <React.Fragment key={job.id}>
                      {renderRow(job, { runCount: runs.length, open })}
                      {open && runs.map((r) => renderRow(r, { child: true }))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
          {hidden > 0 && (
            <button
              onClick={loadMore}
              className="w-full flex items-center justify-center gap-1.5 text-xs py-2 hover:bg-gray-50"
              style={{ color: "#8A8886" }}
              title="Loads automatically as you scroll — click to load now"
            >
              <ChevronDown size={12} />
              Load {Math.min(hidden, COMPLETED_PAGE)} more ({hidden} remaining)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------- status picker ---------------------------- */

/* The pill states what the printer is; the menu states what each state does,
   because "Reserved" on its own doesn't tell an operator their drag will be
   refused. Positioned fixed so it can't be clipped by the group card. */
/* readOnly renders the same pill without the menu: a designer needs to know a
   machine is in maintenance, and has no business putting it there. */
function StatusPicker({ status, onSelect, readOnly }) {
  const state = PRINTER_STATUS[status] || PRINTER_STATUS.Ready;
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const MENU_W = 232;

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pos]);

  const open = (e) => {
    e.stopPropagation();
    const r = btnRef.current.getBoundingClientRect();
    setPos({
      /* 176 ≈ rendered menu height for the current 3 statuses — recompute if
         PRINTER_STATUSES grows or the menu silently clips off-screen */
      top: Math.min(r.bottom + 4, window.innerHeight - 176),
      left: Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8)),
    });
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={readOnly ? undefined : open}
        disabled={readOnly}
        aria-haspopup={readOnly ? undefined : "menu"}
        aria-expanded={readOnly ? undefined : !!pos}
        title={
          readOnly ? `${status} — ${state.blurb}` : `${status} — ${state.blurb}. Click to change.`
        }
        className="flex items-center gap-1 font-semibold px-2 py-1 rounded-full flex-shrink-0"
        style={{ fontSize: 10, background: state.bg, color: state.text }}
      >
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: state.color }}
        />
        {status}
        {!readOnly && <ChevronDown size={11} />}
      </button>

      {pos && (
        <div
          role="menu"
          className="fixed z-50 py-1.5 rounded-lg shadow-xl"
          style={{
            top: pos.top,
            left: pos.left,
            width: MENU_W,
            background: "white",
            border: "1px solid #E1DFDD",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {PRINTER_STATUSES.map((s) => (
            <button
              key={s}
              role="menuitemradio"
              aria-checked={status === s}
              onClick={() => {
                onSelect(s);
                setPos(null);
              }}
              className="w-full flex items-start gap-2 px-3 py-1.5 text-left hover:bg-gray-100"
            >
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: PRINTER_STATUS[s].color, marginTop: 5 }}
              />
              <span className="flex-1 min-w-0">
                <span
                  className="flex items-center justify-between text-sm"
                  style={{ color: "#242424" }}
                >
                  {s}
                  {status === s && (
                    <Check size={13} style={{ color: "#5B5FC7" }} />
                  )}
                </span>
                <span className="block text-xs" style={{ color: "#8A8886" }}>
                  {PRINTER_STATUS[s].blurb}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/* --------------------------- printer column ---------------------------- */

function PrinterColumn({
  printer,
  operator,
  editPrintersMode,
  filteredOut,
  tasks,
  choices,
  settingsOpen,
  addingTask,
  expandedTaskId,
  draggingTaskId,
  onToggleSettings,
  onUpdatePrinter,
  onSetStatus,
  onUpdateSettings,
  onUpdateField,
  onDeletePrinter,
  onStartAddTask,
  onCancelAddTask,
  onAddTask,
  onExpandTask,
  onDropTask,
  onDropOnTask,
  onTaskContextMenu,
  onPrinterContextMenu,
  onDragStart,
  onDragEnd,
}) {
  const { settings } = printer;
  const state = PRINTER_STATUS[printer.status] || PRINTER_STATUS.Ready;
  const accepts = state.accepts;
  const inactive = state.dim; // only Maintenance greys the card out
  /* the card's own chrome reads state, not group — a green top edge means
     "this machine will print". Group identity stays on the dot and chip. */
  const stateColor = state.color;
  const [editingName, setEditingName] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [specsOpen, setSpecsOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  /* Maintenance dims the card, but never the control that brings it back —
     a CSS filter applies to the whole subtree, so the dimming lives on a
     wrapper the status button sits outside of */
  const dim = inactive ? { opacity: 0.55, filter: "grayscale(0.9)" } : undefined;

  /* running queue = active (non-complete) jobs; a job marked Complete leaves
     the card entirely — the completed-jobs table at the foot of the board is
     the only history (item 31; the per-printer Completed section it replaced
     is in that entry) */
  const exceptions = specExceptions(settings);

  const activeTasks = tasks.filter((t) => t.status !== "Complete");

  /* queue slots: 2 visible by default; force open if the task being edited
     sits beyond slot 2 (e.g. just auto-expanded after assignment) */
  const expandedIdx = activeTasks.findIndex((t) => t.id === expandedTaskId);
  const queueExpanded = queueOpen || expandedIdx >= 2;
  const visibleTasks = queueExpanded ? activeTasks : activeTasks.slice(0, 2);
  const hiddenCount = Math.max(0, activeTasks.length - 2);
  const showDrop = dragOver && !!draggingTaskId && accepts;

  const emptyLabel = showDrop
    ? "Drop job here"
    : printer.status === "Maintenance"
    ? "Out for maintenance"
    : printer.status === "Reserved"
    ? "Reserved — no new jobs"
    : "No active jobs";

  return (
    <div
      className="w-full mt-2 rounded-lg flex flex-col transition-all"
      style={{
        minWidth: PRINTER_MIN_W,
        /* Filtered out by jobcode: faded, but still fully interactive. */
        opacity: filteredOut ? 0.35 : 1,
        background: showDrop ? `${stateColor}0D` : "white",
        border: showDrop ? `1px solid ${stateColor}` : "1px solid #E1DFDD",
        borderTop: `4px solid ${stateColor}`,
        boxShadow: showDrop ? `0 0 0 2px ${stateColor}33` : "none",
      }}
      onDragOver={(e) => {
        if (!accepts || !operator || editPrintersMode) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!accepts || !operator || editPrintersMode) return;
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDropTask(id);
        setDragOver(false);
      }}
    >
      {/* ---- printer header (right-click for menu) ---- */}
      <div
        className="px-3 pt-2.5 pb-2 flex items-center gap-2"
        onContextMenu={(e) =>
          operator && !editPrintersMode && onPrinterContextMenu(e, printer.id)
        }
      >
        <div className="flex-1 min-w-0 flex items-center gap-2" style={dim}>
          {editingName ? (
            <input
              autoFocus
              defaultValue={printer.name}
              onBlur={(e) => {
                onUpdatePrinter(printer.id, {
                  name: e.target.value.trim() || printer.name,
                });
                setEditingName(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
              className="flex-1 min-w-0 text-sm font-semibold px-1 py-0.5 rounded border outline-none"
              style={{ borderColor: ACCENT }}
              aria-label="Printer name"
            />
          ) : (
            <button
              onClick={() => operator && !inactive && setEditingName(true)}
              disabled={!operator}
              className="flex-1 min-w-0 text-left text-sm font-semibold truncate"
              style={{ color: "#242424", cursor: operator ? undefined : "default" }}
              title={
                operator ? "Rename printer (or right-click for more)" : printer.name
              }
            >
              {printer.name}
            </button>
          )}

          {operator && !editPrintersMode && (
          <button
            onClick={onToggleSettings}
            className="p-1 rounded hover:bg-gray-100 flex-shrink-0"
            aria-label="Printer settings"
            title="Printer settings"
          >
            <Settings size={15} style={{ color: settingsOpen ? ACCENT : "#605E5C" }} />
          </button>
          )}

          {/* Edit printers mode: the settings gear is swapped for a direct
              remove icon, so a printer can go without opening its settings
              panel first. The panel's own delete button (below) still works
              too — this is just a faster path to the same action. */}
          {operator && editPrintersMode && (
          <button
            onClick={() => onDeletePrinter(printer.id)}
            className="p-1 rounded hover:bg-red-50 flex-shrink-0"
            aria-label={`Delete printer ${printer.name}`}
            title="Delete printer (work returns to staging)"
          >
            <Trash2 size={15} style={{ color: "#D13438" }} />
          </button>
          )}
        </div>

        {/* one control, three states — never dimmed, so a printer in
            maintenance can always be brought back */}
        <StatusPicker
          status={printer.status}
          readOnly={!operator}
          onSelect={(s) => onSetStatus(printer.id, s)}
        />
      </div>

      {/* everything below the header dims with the off state */}
      <div className="flex flex-col flex-1" style={dim}>
        {/* assigned printer settings — compact, collapsible readout */}
        {operator && (
        <div className="px-3 pb-2">
          <button
            onClick={() => setSpecsOpen((v) => !v)}
            className="w-full flex items-start gap-1 text-left"
            aria-expanded={specsOpen}
            title={specsOpen ? "Collapse settings" : "Expand settings"}
          >
            {/* items-start, not items-center: exceptions stack, and a chevron
                centred against a three-line block reads as unaligned. The 2px
                nudge puts it on the first line's baseline. */}
            {specsOpen ? (
              <ChevronDown size={11} style={{ color: "#8A8886", marginTop: 2 }} className="flex-shrink-0" />
            ) : (
              <ChevronRight size={11} style={{ color: "#8A8886", marginTop: 2 }} className="flex-shrink-0" />
            )}
            {exceptions.length === 0 ? (
              <span className="text-xs italic truncate" style={{ color: "#8A8886" }}>
                Standard setup
              </span>
            ) : (
              /* Only what differs, one per line, in the same grey italic as
                 "Standard setup" above — the two states of this line are the
                 same kind of fact and used to look like two different kinds of
                 thing (black-on-grey chips versus grey italics).

                 Stacked rather than wrapped side by side, which is also what
                 the chips were really buying: at this card width a row of
                 values ran together and the one worth reading got lost. The
                 per-line title survives so a truncated value is recoverable. */
              <span className="flex flex-col gap-0.5 min-w-0">
                {exceptions.map((e) => (
                  <span
                    key={e.key}
                    className="text-xs italic truncate"
                    style={{ color: "#8A8886", maxWidth: "100%" }}
                    title={`${e.label}: ${e.text}`}
                  >
                    {e.label}: {e.text}
                  </span>
                ))}
              </span>
            )}
          </button>
          {specsOpen && (
            <div className="pl-4 pt-0.5">
              {PRINTER_FIELDS.map((field) => (
                <div
                  key={field.key}
                  className="italic truncate"
                  style={{ color: "#8A8886", fontSize: 11, lineHeight: 1.5 }}
                  title={`${field.label}: ${settings.fields[field.key]}`}
                >
                  {field.label}: {settings.fields[field.key]}
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {/* ---- settings panel ---- */}
        {settingsOpen && (
          <div
            className="mx-3 mb-2 p-3 rounded-lg space-y-3 text-sm"
            style={{ background: "#FAF9F8", border: "1px solid #EDEBE9" }}
          >
            <div
              className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide"
              style={{ color: "#605E5C" }}
            >
              Printer settings
              <button
                onClick={() => onDeletePrinter(printer.id)}
                className="p-1 rounded hover:bg-red-50 normal-case"
                title="Delete printer (work returns to staging)"
                aria-label="Delete printer"
              >
                <Trash2 size={14} style={{ color: "#D13438" }} />
              </button>
            </div>

            {/* global printer tag fields */}
            {PRINTER_FIELDS.map((field) => (
              <label key={field.key} className="block">
                <span className="text-xs" style={{ color: "#605E5C" }}>
                  {field.label}
                </span>
                <select
                  value={settings.fields[field.key]}
                  onChange={(e) =>
                    onUpdateField(printer.id, field.key, e.target.value)
                  }
                  className="mt-1 w-full text-sm px-2 py-1.5 rounded border bg-white outline-none"
                  style={{ borderColor: "#C8C6C4" }}
                >
                  {optionsFor(choices[field.key], settings.fields[field.key]).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                {/* "Other" is not an answer on its own — a machine is loaded
                    with something specific. Ask for the name rather than
                    leaving the card reading "Other". */}
                {field.key === "printMaterial" &&
                  isOtherMaterial(settings.fields[field.key]) && (
                    <input
                      value={settings.printMaterialOther || ""}
                      onChange={(e) =>
                        onUpdateSettings(printer.id, {
                          printMaterialOther: e.target.value,
                        })
                      }
                      placeholder="Which material?"
                      className="mt-1 w-full text-sm px-2 py-1.5 rounded border outline-none"
                      style={{ borderColor: "#C8C6C4" }}
                      aria-label="Other print material"
                    />
                  )}
              </label>
            ))}

            {/* notes — 3 visible lines, scrolls beyond */}
            <label className="block">
              <span className="text-xs" style={{ color: "#605E5C" }}>
                Notes
              </span>
              <textarea
                rows={3}
                value={settings.notes}
                onChange={(e) =>
                  onUpdateSettings(printer.id, { notes: e.target.value })
                }
                placeholder="Printer notes…"
                className="mt-1 w-full text-sm px-2 py-1.5 rounded border outline-none resize-none overflow-y-auto"
                style={{
                  borderColor: "#C8C6C4",
                  maxHeight: "4.6em",
                  lineHeight: "1.35em",
                }}
              />
            </label>
          </div>
        )}

        {/* ---- active queue (drop zone): fixed-height scroll keeps card stable ---- */}
        <div
          className="px-3 space-y-2 overflow-y-auto"
          style={{ minHeight: 120, maxHeight: 248 }}
        >
          {visibleTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              draggableCard={operator && !editPrintersMode}
              disabled={inactive || !operator || editPrintersMode}
              expanded={expandedTaskId === task.id}
              onExpand={() => !inactive && onExpandTask(task.id)}
              onContextMenu={onTaskContextMenu}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDropOnTask={accepts ? onDropOnTask : undefined}
              dragging={draggingTaskId === task.id}
            />
          ))}

          {/* empty-state / drop hint when no active jobs */}
          {activeTasks.length === 0 && (
            <div
              className="rounded-lg border border-dashed flex items-center justify-center text-xs italic"
              style={{
                minHeight: 96,
                color: showDrop ? ACCENT : "#C8C6C4",
                background: "#FAF9F8",
                borderColor: showDrop ? ACCENT : "#E1DFDD",
              }}
            >
              {emptyLabel}
            </div>
          )}

          {/* expand / collapse the rest of the active queue */}
          {hiddenCount > 0 && (
            <button
              onClick={() => setQueueOpen(!queueExpanded)}
              className="w-full flex items-center justify-center gap-1 text-xs font-medium py-1.5 rounded hover:bg-gray-50"
              style={{ color: inactive ? "#8A8886" : ACCENT }}
            >
              {queueExpanded ? (
                <>
                  <ChevronUp size={13} /> Show less
                </>
              ) : (
                <>
                  <ChevronDown size={13} /> Show {hiddenCount} more queued
                </>
              )}
            </button>
          )}
        </div>

        {/* ---- add task ---- */}
        {operator && (
        <div className="px-3 pb-3 pt-2 mt-auto">
          {addingTask ? (
            <AddTaskForm
              choices={choices}
              showEta
              onCancel={onCancelAddTask}
              onAdd={onAddTask}
            />
          ) : (
            <button
              onClick={onStartAddTask}
              disabled={!accepts}
              className="w-full flex items-center justify-center gap-1.5 text-sm font-medium py-2 rounded-lg border hover:bg-gray-50 disabled:cursor-not-allowed"
              style={{
                borderColor: "#E1DFDD",
                color: accepts ? ACCENT : "#8A8886",
              }}
              title={
                accepts
                  ? "Add a job to this printer"
                  : "Only a Ready printer can take new work"
              }
            >
              <Plus size={15} /> Add job
            </button>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------- task card ------------------------------ */

function TaskCard({
  task,
  draggableCard = true,
  disabled,
  expanded,
  onExpand,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDropOnTask,
  inStaging,
  dragging,
  operator,
}) {
  const eta = formatEta(task.etaDate, task.etaTime);
  /* Operator view, staging only: the card opens a read-only preview — the
     shop asked to see a job's full specs before assigning it, but editing an
     unassigned job stays the designer's. Dragging stays live, since that's
     how an operator assigns the job to a printer; only the right-click menu
     locks. */
  const stagingLocked = inStaging && operator;
  /* An operator note is worth knowing about from the board, and a designer
     cannot open an assigned job at all. Hover alone would hide which cards
     have one, so the icon carries the fact and its tooltip carries the text. */
  const operatorNote = (task.operatorNotes || "").trim();
  const overdue = isOverdue(task);
  /* status is a SharePoint choice column — a value outside the three known
     keys must not take the board down. */
  const st = STATUS_STYLE[task.status] || STATUS_STYLE["Not started"];
  const [overPos, setOverPos] = useState(null); // 'before' | 'after' | null

  const indicatorShadow = !overPos
    ? "none"
    : overPos === "before"
    ? `0 -3px 0 0 ${ACCENT}`
    : `0 3px 0 0 ${ACCENT}`;

  return (
    <div
      draggable={draggableCard && !disabled && !expanded}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
        /* defer the state update so the browser captures the drag image
           before the card re-renders at reduced opacity */
        if (onDragStart) setTimeout(() => onDragStart(task.id), 0);
      }}
      onDragEnd={() => {
        setOverPos(null);
        onDragEnd && onDragEnd();
      }}
      onDragOver={(e) => {
        if (disabled || dragging || !onDropOnTask) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        const r = e.currentTarget.getBoundingClientRect();
        setOverPos(e.clientY - r.top < r.height / 2 ? "before" : "after");
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOverPos(null);
      }}
      onDrop={(e) => {
        if (disabled || !onDropOnTask) return;
        e.preventDefault();
        e.stopPropagation();
        const id = e.dataTransfer.getData("text/plain");
        if (id && id !== task.id) onDropOnTask(id, task.id, overPos || "before");
        setOverPos(null);
      }}
      onContextMenu={(e) =>
        !disabled && !stagingLocked && onContextMenu && onContextMenu(e, task.id)
      }
      className="rounded-lg border"
      style={{
        borderColor: expanded ? ACCENT : "#E1DFDD",
        background: task.status === "Complete" ? "#FAFAF9" : "white",
        opacity: dragging ? 0.4 : 1,
        cursor: disabled ? "default" : "grab",
        boxShadow: indicatorShadow,
      }}
    >
      {/* collapsed card, three rows: name + status / jobcode / ETA + Qty.
          Need by is not here — it lives in the detail modal. Detail in modal. */}
      <button
        onClick={onExpand}
        disabled={disabled}
        className="w-full text-left px-2.5 py-2"
        title={
          disabled
            ? undefined
            : stagingLocked
            ? "Click to preview · drag to assign to a printer"
            : "Click for details · drag to move · right-click for menu"
        }
      >
        {/* Row 1: task name (left) · indicators · status (right). No status
            dot — the pill says the same thing in words. The note icon and the
            priority flag sit just left of the pill: not part of the requested
            name/status layout, but small at-a-glance markers that would have
            nowhere else to go. Status now shows in staging too — the layout
            asks for it on every card, where before it was assigned-only. */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="flex-1 min-w-0 text-sm leading-snug truncate"
            title={task.title}
            style={{
              color: "#242424",
              textDecoration: task.status === "Complete" ? "line-through" : "none",
            }}
          >
            {task.title}
          </span>
          {operatorNote && (
            <span
              className="flex-shrink-0"
              title={`Operator notes: ${operatorNote}`}
              aria-label={`Operator notes: ${operatorNote}`}
            >
              <StickyNote size={11} style={{ color: "#8A8886" }} />
            </span>
          )}
          {task.priority && task.priority !== "Normal" && (
            <Flag
              size={11}
              className="flex-shrink-0"
              style={{ color: PRIORITY_STYLE[task.priority]?.text }}
              title={`Priority: ${task.priority}`}
            />
          )}
          <span
            className="px-1.5 rounded font-medium flex-shrink-0"
            style={{
              background: st.bg,
              color: st.text,
              fontSize: 10,
              lineHeight: "15px",
            }}
          >
            {task.status}
          </span>
        </div>

        {/* Row 2: jobcode, indented under the name so the two read as related
            — the code belongs to the job named above it. Only when the task
            carries one: required on new tasks, but rows created before that
            rule still exist and would otherwise leave a blank indented line. */}
        {task.jobcode && (
          <div
            className="mt-0.5 tabular-nums truncate"
            style={{ paddingLeft: 12, color: "#605E5C", fontSize: 10 }}
            title={`Jobcode: ${task.jobcode}`}
          >
            {task.jobcode}
          </div>
        )}

        {/* Row 3: ETA on the left, Qty on the right. ETA is printers-only and
            unchanged — a prediction that only means something once a job is on
            a printer, so a staging card's left side stays empty and Qty sits
            alone on the right. Red when past due. */}
        <div
          className="mt-1 flex items-center justify-between gap-1.5"
          style={{ fontSize: 10 }}
        >
          <span
            className="flex items-center gap-1.5 min-w-0"
            style={{ color: overdue ? "#D13438" : "#8A8886" }}
          >
            {!inStaging && (
              <>
                <span className="font-semibold uppercase tracking-wide" style={{ fontSize: 9 }}>
                  ETA
                </span>
                <span
                  className={`tabular-nums${overdue ? " font-semibold" : ""}`}
                  style={{ color: overdue ? "#D13438" : "#605E5C" }}
                >
                  {eta ? `${eta.date || "—"}  ${eta.time || ""}`.trim() : "Not set"}
                </span>
              </>
            )}
          </span>
          <span
            className="tabular-nums flex-shrink-0"
            style={{ color: "#605E5C" }}
          >
            Qty {task.quantity || 1}
          </span>
        </div>

        {/* Name the state rather than leaving red to carry it alone. Red is
            also doing work elsewhere on this board — urgent priority, delete
            actions — so a date being red is not self-explanatory. Says
            "overdue" only where it is true: the ETA has passed and the job is
            not finished (isOverdue). */}
        {!inStaging && overdue && (
          <div
            className="font-semibold uppercase tracking-wide"
            style={{ color: "#D13438", fontSize: 9, marginTop: 1 }}
          >
            Overdue
          </div>
        )}
      </button>
    </div>
  );
}

/* -------------------------- task detail modal -------------------------- */

/* Typing edits a local draft and commits on blur, so a task name is one save
   rather than one per letter. Discrete controls (selects, dates, steppers)
   commit immediately, folding in any pending text edit. */
function TaskDetailModal({ task, inStaging, printerStatus, choices, readOnly, onUpdate, onDelete, onCompleteReprint, onClose }) {
  /* item 35 vocabulary: a row with a parent is a run, anything else a job */
  const noun = task.parentId ? "run" : "job";
  const [draft, setDraft] = useState({});

  useEffect(() => {
    setDraft({});
  }, [task.id]);

  const val = (k, fallback = "") =>
    draft[k] !== undefined ? draft[k] : task[k] ?? fallback;
  const edit = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  /* these are re-created each render, so they close over the current draft;
     the Escape listener stays current through closeRef below */
  const commit = (patch = {}) => {
    const pending = { ...draft, ...patch };
    if (Object.keys(pending).length) {
      onUpdate(task.id, pending);
      setDraft({});
    }
  };
  /* named wrapper so onBlur={flush} can't spread the blur event into the patch */
  const flush = () => commit();

  const close = () => {
    flush();
    onClose();
  };

  const backdrop = useBackdropClose(close);

  /* Escape closes, committing any in-flight text edit first. closeRef keeps
     the listener stable so it isn't torn down and rebuilt on every keystroke. */
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const needsSlicing =
    val("sliceStatus", "Not Sliced") === "Not Sliced" ||
    val("sliceStatus", "Not Sliced") === "Needs Nesting";
  const priority = val("priority", "Normal");
  /* read straight off the task, not the draft — neither is editable here */
  const created = formatTimestamp(task.createdAt);
  const completed = formatTimestamp(task.completedAt);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      {...backdrop}
    >
      <div
        className="rounded-xl shadow-2xl w-full max-w-lg flex flex-col"
        style={{ background: "white", maxHeight: "88vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* modal header */}
        <div
          className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0"
          style={{ borderColor: "#EDEBE9" }}
        >
          <h2
            className="flex-1 min-w-0 text-base font-semibold truncate"
            style={{ color: "#242424" }}
            title={val("title")}
          >
            {val("title") || `Untitled ${noun}`}
          </h2>
          {priority !== "Normal" && (
            <span
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0"
              style={{
                background: PRIORITY_STYLE[priority]?.bg,
                color: PRIORITY_STYLE[priority]?.text,
                fontSize: 11,
              }}
            >
              <Flag size={10} />
              {priority}
            </span>
          )}
          <button
            onClick={close}
            className="p-1 rounded hover:bg-gray-100 flex-shrink-0"
            aria-label="Close"
          >
            <X size={18} style={{ color: "#605E5C" }} />
          </button>
        </div>

        {/* modal body — scrolls if tall. Operator previewing a staging job:
            one disabled fieldset turns every control read-only at once —
            no per-field plumbing, nothing to forget on the next field.
            min-w-0 because fieldset's native min-width is min-content. */}
        <div className="px-4 py-3 overflow-y-auto">
          <fieldset disabled={readOnly} className="min-w-0 space-y-3">
          <Field label={task.parentId ? "Run name" : "Job name"}>
            <input
              value={val("title")}
              onChange={(e) => edit("title", e.target.value)}
              onBlur={flush}
              className={MODAL_INPUT}
              style={MODAL_STYLE}
              aria-label={task.parentId ? "Run name" : "Job name"}
            />
          </Field>

          <Field label="Jobcode">
            <input
              value={val("jobcode")}
              onChange={(e) => edit("jobcode", e.target.value)}
              onBlur={flush}
              className={MODAL_INPUT}
              style={MODAL_STYLE}
              aria-label="Jobcode"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Sent by">
              <PeoplePicker
                single
                value={val("sentBy")}
                onChange={(v) => commit({ sentBy: v })}
                placeholder="Requester"
              />
            </Field>
            <Field label="Give to">
              <PeoplePicker
                single
                value={val("giveTo")}
                onChange={(v) => commit({ giveTo: v })}
                placeholder="Recipient"
              />
            </Field>
          </div>

          {/* Jobs only — a run carries a snapshot of this list, but the
              notification will read it off the job, so editing it on a run
              would edit a copy nothing looks at. */}
          {!task.parentId && (
            <Field label="Notify when print starts">
              <PeoplePicker
                value={val("notifyPeople", [])}
                onChange={(next) => commit({ notifyPeople: next })}
              />
            </Field>
          )}

          {/* The requester's note. Editable only while the job is in staging:
              once it is on a printer it is a record of what was asked for, and
              a record that can be rewritten afterwards is not one. Read-only
              for everybody, operator included — the operator has their own
              field below. Hidden entirely when assigned and empty, rather than
              showing a permanent blank. */}
          {inStaging ? (
            <Field label="Notes">
              <textarea
                rows={3}
                value={val("notes")}
                onChange={(e) => edit("notes", e.target.value)}
                onBlur={flush}
                placeholder="Anything the operator should know"
                className={`${MODAL_INPUT} resize-none`}
                style={MODAL_STYLE}
                aria-label="Notes"
              />
            </Field>
          ) : (
            val("notes") && (
              <Field label="Notes — from the requester">
                <div
                  className="whitespace-pre-wrap"
                  style={{ color: "#8A8886", fontSize: 13, lineHeight: 1.45 }}
                >
                  {val("notes")}
                </div>
              </Field>
            )
          )}

          {/* The operator's note, which only exists once there is an operator:
              a job in staging has no one working it yet. */}
          {!inStaging && (
            <Field label="Operator notes">
              <textarea
                rows={3}
                value={val("operatorNotes")}
                onChange={(e) => edit("operatorNotes", e.target.value)}
                onBlur={flush}
                placeholder="Notes while running this job"
                className={`${MODAL_INPUT} resize-none`}
                style={MODAL_STYLE}
                aria-label="Operator notes"
              />
            </Field>
          )}

          <Field label="Filepath">
            <input
              value={val("filepath")}
              onChange={(e) => edit("filepath", e.target.value)}
              onBlur={flush}
              placeholder="\\server\prints\part.3mf"
              className={MODAL_INPUT}
              style={{ ...MODAL_STYLE, fontFamily: "Consolas, 'Courier New', monospace" }}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <QuantityInput
                value={val("quantity", 1) || 1}
                min={1}
                max={9999}
                height={38}
                onBlur={flush}
                onChange={(v) => edit("quantity", v)}
              />
            </Field>
            <Field label="Priority">
              <select
                value={priority}
                onChange={(e) => commit({ priority: e.target.value })}
                className={MODAL_SELECT}
                style={MODAL_STYLE}
              >
                {PRIORITIES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* Need by is a deadline and applies to any task, assigned or not.
              ETA is a prediction and only means something once the job has a
              printer, so it stays printers-only. */}
          <Field label="Need by">
            <input
              type="date"
              value={val("needByDate")}
              onChange={(e) => commit({ needByDate: e.target.value })}
              className={MODAL_INPUT}
              style={MODAL_STYLE}
              aria-label="Need by date"
            />
          </Field>

          {/* ETA — printers only */}
          {!inStaging && (
            <Field label="ETA">
              <EtaQuickPick
                etaDate={val("etaDate")}
                etaTime={val("etaTime")}
                onPick={commit}
              />
            </Field>
          )}

          <div className={inStaging ? "" : "grid grid-cols-2 gap-3"}>
            <Field label="Material">
              <select
                value={val("printMaterial", "ABS")}
                onChange={(e) => commit({ printMaterial: e.target.value })}
                className={MODAL_SELECT}
                style={MODAL_STYLE}
              >
                {optionsFor(choices.taskPrintMaterial, val("printMaterial", "ABS")).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>

            <Field label="Slicing">
              <select
                value={val("sliceStatus", "Not Sliced")}
                onChange={(e) => commit({ sliceStatus: e.target.value })}
                className={MODAL_SELECT}
                style={MODAL_STYLE}
              >
                {TASK_TAGS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            {!inStaging && (
              <Field label="Status">
                <select
                  value={task.status}
                  onChange={(e) => {
                    /* an action riding in the status dropdown (item 33):
                       flush pending edits into *this* row first — the modal
                       switches to the successor, and drafts reset on task
                       change rather than following it */
                    if (e.target.value === "Complete & reprint") {
                      flush();
                      onCompleteReprint(task.id);
                      return;
                    }
                    commit({ status: e.target.value });
                  }}
                  className={MODAL_SELECT}
                  style={MODAL_STYLE}
                  title={
                    canStartWork(printerStatus)
                      ? undefined
                      : `${printerStatus} — a job cannot be started on this printer`
                  }
                >
                  {STATUSES.map((s) => (
                    <option
                      key={s}
                      disabled={s === "In progress" && !canStartWork(printerStatus)}
                    >
                      {s}
                    </option>
                  ))}
                  <option disabled={task.status === "Complete"}>
                    Complete &amp; reprint
                  </option>
                </select>
              </Field>
            )}
          </div>

          {/* slicer settings — only while pre-slice */}
          {needsSlicing && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Print quality">
                <select
                  value={val("printQuality", "Medium")}
                  onChange={(e) => commit({ printQuality: e.target.value })}
                  className={MODAL_SELECT}
                  style={MODAL_STYLE}
                >
                  {optionsFor(choices.printQuality, val("printQuality", "Medium")).map((q) => (
                    <option key={q}>{q}</option>
                  ))}
                </select>
              </Field>
              <Field label="Print strength">
                <select
                  value={val("printStrength", "Standard")}
                  onChange={(e) => commit({ printStrength: e.target.value })}
                  className={MODAL_SELECT}
                  style={MODAL_STYLE}
                >
                  {optionsFor(choices.printStrength, val("printStrength", "Standard")).map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          </fieldset>
        </div>

        {/* Created / completed stamps — read-only facts, not fields anyone
            edits, so they sit outside the form body rather than as a Field.
            Completed only appears once the task has actually completed. */}
        {(created || completed) && (
          <div
            className="px-4 pb-2 flex-shrink-0"
            style={{ color: "#A19F9D", fontSize: 10 }}
          >
            {created && <>Created {created}</>}
            {created && completed && " · "}
            {completed && <>Completed {completed}</>}
          </div>
        )}

        {/* modal footer */}
        <div
          className="flex items-center justify-between px-4 py-3 border-t flex-shrink-0"
          style={{ borderColor: "#EDEBE9" }}
        >
          {readOnly ? (
            /* keeps Done pinned right under justify-between */
            <span
              className="text-sm px-2 py-1.5"
              style={{ color: "#8A8886" }}
            >
              Preview — assign to a printer to edit
            </span>
          ) : (
            <button
              onClick={() => onDelete(task.id)}
              className="flex items-center gap-1.5 text-sm font-medium px-2 py-1.5 rounded hover:bg-red-50"
              style={{ color: "#D13438" }}
              title={`Delete ${noun}`}
            >
              <Trash2 size={15} /> Delete
            </button>
          )}
          <button
            onClick={close}
            className="text-sm font-medium px-4 py-1.5 rounded text-white"
            style={{ background: "#5B5FC7" }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/* shared field chrome for the detail modal — comfortable sizing.
   A <div> rather than a <label>: a label forwards its click to the first
   control inside it, which on a stepper means clicking the caption changes
   the number. */
const MODAL_INPUT =
  "w-full text-sm px-2.5 rounded border outline-none focus:ring-1";
const MODAL_SELECT = `${MODAL_INPUT} bg-white`;
const MODAL_STYLE = { borderColor: "#C8C6C4", height: 38 };

function Field({ label, children }) {
  return (
    <div>
      <span
        className="block mb-0.5 font-semibold uppercase tracking-wide"
        style={{ color: "#8A8886", fontSize: 9, letterSpacing: "0.04em" }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

/* The only ETA entry: one click on a duration bucket — the shop asked for
   this after date+time pickers per run failed to scale to hundreds of
   runs. The readout line underneath is the feedback that the click landed,
   and its "clear" is the only way left to unset an ETA now that the
   pickers are gone. */
function EtaQuickPick({ etaDate, etaTime, onPick, stack }) {
  const eta = formatEta(etaDate, etaTime);
  return (
    <div>
      {/* stack: two-up grid for the narrow printer-column add form, where
          four across cramps the labels */}
      <div className={stack ? "grid grid-cols-2 gap-2" : "flex gap-2"}>
        {ETA_PRESETS.map(([label, sub, hours]) => (
          <button
            key={label}
            type="button"
            onClick={() => onPick(quickEta(hours))}
            className="flex-1 min-w-0 px-1 py-1.5 rounded border bg-white hover:bg-gray-50 text-center"
            style={{ borderColor: "#C8C6C4" }}
          >
            <span className="block text-xs font-semibold" style={{ color: "#323130" }}>
              {label}
            </span>
            <span className="block" style={{ fontSize: 9, color: "#8A8886" }}>
              {sub}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-1" style={{ fontSize: 11, color: "#605E5C" }}>
        {eta ? (
          <>
            {`${eta.date} ${eta.time}`.trim()}{" "}
            <button
              type="button"
              onClick={() => onPick({ etaDate: "", etaTime: "" })}
              className="underline"
              style={{ color: "#8A8886" }}
            >
              clear
            </button>
          </>
        ) : (
          "Not set"
        )}
      </div>
    </div>
  );
}

/* ---------------------------- number input ----------------------------- */

/* Native number input (this replaced a hand-drawn ± stepper: the browser's
   spinners and ↑/↓ keys do the same job). The raw string rides local state
   while typing so the field can be emptied mid-edit — clamping on every
   keystroke made clear-then-type impossible and turned "0" into 1 under the
   typist's fingers. Every parseable value is pushed upstream immediately, so
   nothing is lost if the surrounding form closes without a blur. */
function QuantityInput({ value, min = 1, max = 9999, height = 30, onChange, onBlur }) {
  const [draft, setDraft] = useState(null); // null = not mid-edit
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={draft ?? value}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const n = parseInt(raw, 10);
        if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
      }}
      onBlur={() => {
        setDraft(null);
        onBlur?.();
      }}
      className="rounded border bg-white text-sm text-center outline-none w-full min-w-0"
      style={{ borderColor: "#C8C6C4", height, maxWidth: 96 }}
      aria-label="Quantity"
    />
  );
}

/* --------------------------- people picker ---------------------------- */

/* The picker's directory, fetched once per session and filtered
   client-side — at this shop's size a per-keystroke Graph query is pure
   overhead.

   Inside Teams the source is the roster of the team the tab is open in
   (the tenant list is full of guests, shared mailboxes and service
   accounts nobody wants to scroll past), so who appears in the picker
   is managed by managing team membership — in Teams, not in Entra.
   Outside Teams, or when the tab isn't in a team channel, it falls back
   to the whole tenant. The /microsoft.graph.user cast keeps nested
   groups and devices out of a roster read.

   Resolves to null on failure (no consent yet, seed mode, no network)
   so the picker can degrade instead of breaking the form; the cache is
   cleared on failure so the next mount retries. */
let peopleCache = null;
function loadPeople() {
  if (!peopleCache)
    peopleCache = (async () => {
      let groupId = null;
      try {
        if (await inTeams()) {
          const ctx = await window.microsoftTeams.app.getContext();
          groupId = ctx?.team?.groupId || null;
        }
      } catch {
        /* no context — the tenant fallback below still works */
      }
      const select = "$select=id,displayName,mail,userPrincipalName&$top=999";
      const res = await graph(
        groupId
          ? `/groups/${groupId}/members/microsoft.graph.user?${select}`
          : `/users?${select}`
      );
      return (
        (res.value || [])
          /* mail filters out service accounts and unlicensed objects;
             #EXT# in the UPN marks guests (invited gmail/external
             accounts); "[ARCHIVE] Firstname Lastname" is this tenant's
             convention for departed users — matched case-insensitively
             to survive a half-typed rename */
          .filter(
            (u) =>
              u.mail &&
              u.displayName &&
              !(u.userPrincipalName || "").includes("#EXT#") &&
              !u.displayName.toUpperCase().includes("[ARCHIVE]")
          )
          .map((u) => ({ id: u.id, name: u.displayName }))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    })().catch((err) => {
      console.warn("Directory unreadable; people picker degraded.", err);
      peopleCache = null;
      return null;
    });
  return peopleCache;
}

/* Display name of the signed-in account, for the pinned "you" chip.
   Empty when running on seed data with no sign-in. */
const currentAccountName = () => msalApp?.getAllAccounts?.()[0]?.name || "";

/* People chooser, rendered as removable chips plus a type-ahead.

   Two shapes, one component:
   - default: multi-select; `value`/`onChange` carry [{id, name}].
   - `single`: one person; `value`/`onChange` carry a display-name
     string, so it can front an existing plain-text column (SentBy,
     GiveTo) without a schema change. The type-ahead hides while a name
     is chosen, and if the directory can't be read the field falls back
     to a plain text input rather than dead-ending a required field.

   `pinnedName`, when set, renders a fixed non-removable chip for the
   person who is always notified (the job's creator). */
function PeoplePicker({ value, onChange, pinnedName, single, placeholder }) {
  const [people, setPeople] = useState(undefined); // undefined = loading, null = unavailable
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    loadPeople().then((p) => live && setPeople(p));
    return () => {
      live = false;
    };
  }, []);

  const selected = single
    ? value
      ? [{ id: value, name: value }]
      : []
    : value || [];
  const chosen = new Set(selected.map((p) => p.id));
  const q = query.trim().toLowerCase();
  const matches = (people || []).filter(
    (p) =>
      !chosen.has(p.id) &&
      /* the pinned creator is already notified — offering them again would
         make a second chip and a double ping */
      !(pinnedName && p.name === pinnedName) &&
      (!q || p.name.toLowerCase().includes(q))
  );

  const add = (p) => {
    onChange(single ? p.name : [...selected, p]);
    setQuery("");
    /* in single mode the pick unmounts the input, so its blur never fires —
       close here or the list sticks open with nothing left to close it */
    if (single) setOpen(false);
  };
  const remove = (id) =>
    onChange(single ? "" : selected.filter((p) => p.id !== id));

  if (single && people === null)
    return (
      <input
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full text-xs px-2 py-1.5 rounded border outline-none"
        style={{ borderColor: "#C8C6C4" }}
        aria-label={placeholder}
      />
    );

  const chip = (label, onRemove, title) => (
    <span
      key={label}
      title={title}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
      style={{ background: `${ACCENT}1A`, color: "#444791", fontSize: 11 }}
    >
      {label}
      {onRemove && (
        <button
          onClick={onRemove}
          className="rounded-full hover:bg-white"
          aria-label={`Stop notifying ${label}`}
        >
          <X size={11} />
        </button>
      )}
    </span>
  );

  return (
    <div className="relative">
      <div
        className="flex flex-wrap items-center gap-1 rounded border bg-white px-1.5 py-1"
        style={{ borderColor: "#C8C6C4", minHeight: 34 }}
      >
        {pinnedName &&
          chip(`${pinnedName} · you`, null, "The job's creator is always notified")}
        {selected.map((p) => chip(p.name, () => remove(p.id)))}
        {people === null ? (
          <span style={{ color: "#8A8886", fontSize: 11 }}>
            Directory unavailable
          </span>
        ) : single && selected.length ? null : (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches[0]) {
                e.preventDefault();
                add(matches[0]);
              } else if (e.key === "Enter" && q) {
                /* nobody in the roster matched — take the typed name verbatim,
                   or a required Sent by/Give to is unfillable for anyone
                   outside the team */
                e.preventDefault();
                add({ id: query.trim(), name: query.trim() });
              }
              if (e.key === "Escape" && open) {
                /* dismiss just the list — without this the modal's
                   window-level Escape handler closes the whole editor too */
                e.stopPropagation();
                setOpen(false);
              }
              if (e.key === "Backspace" && !query && selected.length)
                remove(selected[selected.length - 1].id);
            }}
            placeholder={
              people === undefined
                ? "Loading directory…"
                : placeholder || "Add people…"
            }
            disabled={people === undefined}
            className="flex-1 text-xs outline-none bg-transparent"
            style={{ minWidth: 70, color: "#242424", padding: "2px" }}
            aria-label={placeholder || "Search people to notify"}
          />
        )}
      </div>
      {open && (matches.length > 0 || q) && (
        <div
          className="absolute left-0 right-0 z-10 rounded-b border bg-white shadow-lg overflow-y-auto"
          style={{ borderColor: "#C8C6C4", maxHeight: 180 }}
          /* the list scrolls the whole directory now, so its scrollbar is a
             click target — preventDefault keeps that click from blurring the
             input and closing the list mid-scroll */
          onMouseDown={(e) => e.preventDefault()}
        >
          {matches.map((p) => (
            <button
              key={p.id}
              /* onMouseDown, so selection lands before the input's blur
                 closes the list */
              onMouseDown={(e) => {
                e.preventDefault();
                add(p);
              }}
              className="block w-full text-left px-2 py-1.5 text-xs hover:bg-gray-100"
              style={{ color: "#242424" }}
            >
              {p.name}
            </button>
          ))}
          {matches.length === 0 && (
            /* same free-text escape the directory-down path gets: a name
               outside the roster is still a name */
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                add({ id: query.trim(), name: query.trim() });
              }}
              className="block w-full text-left px-2 py-1.5 text-xs hover:bg-gray-100"
              style={{ color: "#242424" }}
            >
              Add “{query.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------- add task form ---------------------------- */

function AddTaskForm({ choices, showEta, onAdd, onCancel }) {
  const [title, setTitle] = useState("");
  const [jobcode, setJobcode] = useState("");
  const [notes, setNotes] = useState("");
  const [needByDate, setNeedByDate] = useState("");
  const [etaDate, setEtaDate] = useState("");
  const [etaTime, setEtaTime] = useState("");
  /* prefilled with the signed-in user — the requester nearly always is;
     the chip removes like any other for on-behalf-of submissions */
  const [sentBy, setSentBy] = useState(currentAccountName());
  const [giveTo, setGiveTo] = useState("");
  const [filepath, setFilepath] = useState("");
  const [sliceStatus, setSliceStatus] = useState("Not Sliced");
  const [printMaterial, setPrintMaterial] = useState("ABS");
  const [printQuality, setPrintQuality] = useState("Medium");
  const [printStrength, setPrintStrength] = useState("Standard");
  const [quantity, setQuantity] = useState(1);
  const [priority, setPriority] = useState("Normal");
  const [notifyPeople, setNotifyPeople] = useState([]);

  const needsSlicing =
    sliceStatus === "Not Sliced" || sliceStatus === "Needs Nesting";

  const canSubmit =
    title.trim() && jobcode.trim() && sentBy.trim() && giveTo.trim() && filepath.trim();

  const submit = () => {
    if (!canSubmit) return;
    onAdd({
      title: title.trim(),
      jobcode: jobcode.trim(),
      notes: notes.trim(),
      needByDate,
      etaDate: showEta ? etaDate : "",
      etaTime: showEta ? etaTime : "",
      sentBy: sentBy.trim(),
      giveTo: giveTo.trim(),
      filepath: filepath.trim(),
      sliceStatus,
      printMaterial,
      quantity,
      priority,
      notifyPeople,
      ...(needsSlicing ? { printQuality, printStrength } : {}),
    });
  };

  return (
    <div
      className="p-2.5 rounded-lg space-y-2"
      style={{ background: "#FAF9F8", border: `1px solid ${ACCENT}55` }}
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Job name *"
        className="w-full text-sm px-2 py-1.5 rounded border outline-none"
        style={{ borderColor: "#C8C6C4" }}
        aria-label="Job name (required)"
      />
      <input
        value={jobcode}
        onChange={(e) => setJobcode(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Jobcode *"
        className="w-full text-xs px-2 py-1.5 rounded border outline-none"
        style={{ borderColor: "#C8C6C4" }}
        aria-label="Jobcode (required)"
      />
      <div className="flex gap-2">
        <div className="flex-1 min-w-0">
          <PeoplePicker single value={sentBy} onChange={setSentBy} placeholder="Sent by *" />
        </div>
        <div className="flex-1 min-w-0">
          <PeoplePicker single value={giveTo} onChange={setGiveTo} placeholder="Give to *" />
        </div>
      </div>
      <div className="text-xs" style={{ color: "#605E5C" }}>
        <span className="block">Notify when print starts</span>
        <div className="mt-0.5">
          <PeoplePicker
            value={notifyPeople}
            onChange={setNotifyPeople}
            pinnedName={currentAccountName()}
          />
        </div>
      </div>
      <textarea
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes — anything the operator should know"
        className="w-full text-xs px-2 py-1.5 rounded border outline-none resize-none"
        style={{ borderColor: "#C8C6C4" }}
        aria-label="Notes"
      />
      <input
        value={filepath}
        onChange={(e) => setFilepath(e.target.value)}
        placeholder="Filepath, e.g. \\server\prints\part.3mf *"
        className="w-full text-xs px-2 py-1.5 rounded border outline-none"
        style={{
          borderColor: "#C8C6C4",
          fontFamily: "Consolas, 'Courier New', monospace",
        }}
        aria-label="Filepath (required)"
      />
      <div className="text-xs" style={{ color: "#605E5C" }}>
        <span className="block">Quantity</span>
        <div className="mt-0.5">
          <QuantityInput
            value={quantity}
            min={1}
            max={9999}
            height={38}
            onChange={(v) => setQuantity(v)}
          />
        </div>
      </div>
      <label className="block text-xs" style={{ color: "#605E5C" }}>
        Priority
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="mt-0.5 w-full text-xs px-2 py-1.5 rounded border bg-white outline-none"
          style={{ borderColor: "#C8C6C4" }}
        >
          {PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      {/* Two dates, so each has to say which it is — a bare pair of pickers
          was survivable with one and is not with two. Need by is a deadline
          and applies from the moment the job exists; ETA is a prediction and
          only means anything once the job has a printer. */}
      <label className="block text-xs" style={{ color: "#605E5C" }}>
        <span className="block">Need by</span>
        <input
          type="date"
          value={needByDate}
          onChange={(e) => setNeedByDate(e.target.value)}
          className="mt-0.5 w-full text-xs px-2 py-1.5 rounded border outline-none"
          style={{ borderColor: "#C8C6C4" }}
          aria-label="Need by date"
        />
      </label>
      {showEta && (
        <div className="text-xs" style={{ color: "#605E5C" }}>
          <span className="block mb-0.5">ETA</span>
          <EtaQuickPick
            etaDate={etaDate}
            etaTime={etaTime}
            stack
            onPick={(p) => {
              setEtaDate(p.etaDate);
              setEtaTime(p.etaTime);
            }}
          />
        </div>
      )}
      <label className="block text-xs" style={{ color: "#605E5C" }}>
        <span className="block">Material</span>
        <select
          value={printMaterial}
          onChange={(e) => setPrintMaterial(e.target.value)}
          className="mt-0.5 w-full text-xs px-2 py-1.5 rounded border bg-white outline-none"
          style={{ borderColor: "#C8C6C4" }}
          aria-label="Material"
        >
          {optionsFor(choices.taskPrintMaterial, printMaterial).map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <select
        value={sliceStatus}
        onChange={(e) => setSliceStatus(e.target.value)}
        className="w-full text-xs px-2 py-1.5 rounded border bg-white outline-none"
        style={{ borderColor: "#C8C6C4" }}
        aria-label="Slicing status"
      >
        {TASK_TAGS.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      {needsSlicing && (
        <div className="flex gap-2">
          <label className="flex-1 min-w-0 text-xs" style={{ color: "#605E5C" }}>
            Print quality
            <select
              value={printQuality}
              onChange={(e) => setPrintQuality(e.target.value)}
              className="mt-0.5 w-full text-xs px-2 py-1.5 rounded border bg-white outline-none"
              style={{ borderColor: "#C8C6C4" }}
            >
              {optionsFor(choices.printQuality, printQuality).map((q) => (
                <option key={q}>{q}</option>
              ))}
            </select>
          </label>
          <label className="flex-1 min-w-0 text-xs" style={{ color: "#605E5C" }}>
            Print strength
            <select
              value={printStrength}
              onChange={(e) => setPrintStrength(e.target.value)}
              className="mt-0.5 w-full text-xs px-2 py-1.5 rounded border bg-white outline-none"
              style={{ borderColor: "#C8C6C4" }}
            >
              {optionsFor(choices.printStrength, printStrength).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="flex-1 text-sm font-medium text-white py-1.5 rounded disabled:cursor-not-allowed"
          style={{ background: ACCENT, opacity: canSubmit ? 1 : 0.5 }}
        >
          Add job
        </button>
        <button
          onClick={onCancel}
          className="px-3 text-sm rounded border hover:bg-white"
          style={{ borderColor: "#C8C6C4", color: "#605E5C" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* =====================================================================
   PHASE 2 — SHAREPOINT PERSISTENCE

   Everything below this line is the storage layer. Nothing above it
   changed except that PrintFarmScheduler now accepts two optional props
   (`initial` and `onPersist`); with neither, it behaves exactly as it
   did before — in-memory sample data.

   HOW IT DECIDES WHAT TO DO
   If SP.clientId is empty the app runs on sample data, no sign-in.
   Fill in clientId and tenantId and it requires sign-in and reads and
   writes the four SharePoint lists instead. That is the whole switch.

   HOW SAVING WORKS
   No mutation handler was rewritten. `reindex()` preserves object
   identity for rows it didn't touch, so after any change we compare the
   new arrays against the last saved snapshot by reference: rows that
   are a different object got edited, rows that appeared are new, rows
   that vanished were deleted. Writes are debounced so dragging a card
   produces one save, not thirty.
   ===================================================================== */

import { PublicClientApplication } from "@azure/msal-browser";

/* ---- paste these two from the sysadmin, then redeploy ---- */
const SP = {
  clientId: "948b6982-588a-4a0f-a109-169675cb4fd9", // Application (client) ID
  tenantId: "70aa5330-416f-48cb-a64f-1a89f0196577", // Directory (tenant) ID
  hostname: "twosevennet.sharepoint.com",
  sitePath: "/sites/Ticketing",
};

const GRAPH = "https://graph.microsoft.com/v1.0";
/* User.ReadBasic.All and GroupMember.Read.All feed the notify-people
   picker: the first reads people's names, the second the roster of the
   team the tab is open in. auth.html carries its own copy of this list
   — keep them in step. */
const SCOPES = [
  "Sites.ReadWrite.All",
  "User.ReadBasic.All",
  "GroupMember.Read.All",
  /* activity-feed pings (item 12). Until this consent is granted in Entra,
     token requests fail silent and fall back to interactive, where the
     person is asked once — the board still loads either way. */
  "TeamsActivity.Send",
];
const configured = () => Boolean(SP.clientId && SP.tenantId);

/* ---------------------------------------------------------------------
   COLUMN NAMES — verify against the real lists before first run.

   Left side is the app's field, right side is the SharePoint column's
   INTERNAL name (List settings → click the column → the `Field=` value
   at the end of the address bar). Internal names keep the spelling the
   column had when it was created, so a column renamed later still
   answers to its original name here.
   --------------------------------------------------------------------- */
const COLS = {
  groups: {
    uuid: "GroupID",       // our crypto UUID, not SharePoint's row ID
    name: "Title",
    color: "Color",
    sortOrder: "SortOrder",
  },
  printers: {
    /* If you keep the column named "Printer ID" instead of recreating it,
       change this to "Printer_x0020_ID" — SharePoint encodes the space into
       the internal name at creation and a later rename does not undo it. */
    uuid: "PrinterID",
    name: "Title",
    groupId: "GroupID",
    status: "Status",
    notes: "Notes",
    /* free text, used only when printMaterial is an "Other" */
    printMaterialOther: "PrintMaterialOther",
    sortOrder: "SortOrder",
    // the five spec dropdowns come from PRINTER_FIELDS[].column
  },
  tasks: {
    uuid: "TaskID",
    printerId: "PrinterID", // holds the literal string "staging" when unassigned
    /* Empty for a Job (and for every row that predates item 32); a subtask
       carries its parent Job's TaskID here. Note the internal name's capital
       D — confirmed at creation 2026-08-17, and not the "ParentId" the design
       doc proposed. Do not "fix" it. */
    parentId: "ParentID",
    title: "Title",
    jobcode: "Jobcode",
    /* The requester's note, written while the job is in staging and frozen
       once it reaches a printer — a record of what was asked for, not a live
       field. Distinct from the Printers list's Notes column of the same name;
       different list, no clash. */
    notes: "Notes",
    /* The operator's working note, and the only one of the two that stays
       editable once the job is assigned. */
    operatorNotes: "OperatorNotes",
    status: "Status",
    priority: "Priority",
    sliceStatus: "SliceStatus",
    quantity: "Quantity",
    etaDate: "EtaDate",
    etaTime: "EtaTime",
    /* A deadline, where EtaDate is a prediction. Same noon-UTC treatment —
       see dateToIso. */
    needByDate: "NeedByDate",
    sentBy: "SentBy",
    giveTo: "GiveTo",
    /* Extra people to ping when the job starts printing, as JSON —
       [{id, name}] with Entra object ids — in a plain text column. A
       Person column would round-trip through site-user lookup ids,
       which Graph makes painful, and nothing but this app reads the
       field. The job's creator is not stored here: SharePoint already
       records them as the row's author. */
    notifyPeople: "NotifyPeople",
    filepath: "Filepath",
    printQuality: "PrintQuality",
    printStrength: "PrintStrength",
    /* the task's own material — what the designer is asking for. Distinct
       from the Printers column of the same name, which is what the machine
       is currently loaded with. Same name, different list, no clash. */
    printMaterial: "PrintMaterial",
    sortOrder: "SortOrder",
    /* Machine-set instants, not user-picked dates — see the note by
       dateToIso/isoToDate below before touching either of these. */
    createdAt: "CreatedAt",
    completedAt: "CompletedAt",
  },
};

/* `collapsed` is per-person and is not written to SharePoint. Folding a
   group is one operator's view of the board, not a fact about the shop,
   and a shared Yes/No column would have folded it for everyone. The
   Collapsed column in the Groups list is left unused on purpose; the
   per-person memory of it lives in localStorage (pfs.collapsedGroups). */

/* ------------------------------ MSAL ---------------------------------- */

/* Memoize the PROMISE, not the client: assigning the client before its
   initialize() resolved handed a concurrent caller a half-built instance
   (uninitialized_public_client_application). A failed init clears the memo
   so a retry can succeed. */
let msalPromise = null;
/* set once initialize() completes — currentAccountName reads it synchronously */
let msalApp = null;
const msal = () =>
  (msalPromise ??= (async () => {
    const app = new PublicClientApplication({
      auth: {
        clientId: SP.clientId,
        authority: `https://login.microsoftonline.com/${SP.tenantId}`,
        redirectUri: window.location.origin + window.location.pathname,
      },
      cache: { cacheLocation: "localStorage", storeAuthStateInCookie: false },
    });
    await app.initialize();
    await app.handleRedirectPromise();
    msalApp = app;
    return app;
  })().catch((err) => {
    msalPromise = null;
    throw err;
  }));

/* Are we running inside a Teams tab? The SDK resolves only in Teams, so a
   short race against a timer answers it without hanging in a browser. */
let inTeamsCache = null;
async function inTeams() {
  if (inTeamsCache !== null) return inTeamsCache;
  const sdk = window.microsoftTeams;
  if (!sdk) return (inTeamsCache = false);
  inTeamsCache = await Promise.race([
    sdk.app.initialize().then(() => true).catch(() => false),
    new Promise((r) => setTimeout(() => r(false), 2000)),
  ]);
  return inTeamsCache;
}

/* Teams forbids a popup opened by page script, which is why loginPopup fails
   there with popup_window_error. Teams opens the window itself instead and
   points it at auth.html, which runs the redirect and writes the token to
   localStorage where this tab can read it. Outside Teams, in a plain browser
   tab, the ordinary MSAL popup is fine. */
async function teamsSignIn() {
  const url = window.location.origin + window.location.pathname + "auth.html";
  await window.microsoftTeams.authentication.authenticate({
    url,
    width: 600,
    height: 640,
  });
  const app = await msal();
  const account = app.getAllAccounts()[0];
  if (!account) throw new Error("Sign-in finished but no account was cached.");
  app.setActiveAccount(account);
  return account;
}

/* Teams already knows who you are, so try to get a token without asking.
   ssoSilent completes against the existing Microsoft session in a hidden
   frame; the login hint from the Teams context tells it which account to
   use so it never has to show a chooser.

   This is not the full Teams SSO handshake. That one (getAuthToken plus an
   on-behalf-of exchange) needs a server holding a client secret, and this
   app has no server. What it does mean in practice: nobody signs in twice,
   and most people never see the button at all. */
async function silentSignIn() {
  const app = await msal();

  const existing = app.getActiveAccount() || app.getAllAccounts()[0];
  if (existing) {
    app.setActiveAccount(existing);
    try {
      await app.acquireTokenSilent({ scopes: SCOPES, account: existing });
      return existing;
    } catch {
      /* cached account but stale token — fall through and re-establish */
    }
  }

  let loginHint;
  try {
    if (await inTeams()) {
      const ctx = await window.microsoftTeams.app.getContext();
      loginHint = ctx?.user?.userPrincipalName || ctx?.user?.loginHint;
    }
  } catch {
    /* no context available; ssoSilent can still succeed without a hint */
  }

  try {
    const res = await app.ssoSilent({ scopes: SCOPES, loginHint });
    app.setActiveAccount(res.account);
    return res.account;
  } catch {
    return null; // third-party frames blocked, or no session — ask instead
  }
}

async function signIn() {
  if (await inTeams()) return teamsSignIn();
  const app = await msal();
  const res = await app.loginPopup({ scopes: SCOPES, prompt: "select_account" });
  app.setActiveAccount(res.account);
  return res.account;
}

async function currentAccount() {
  const app = await msal();
  return app.getActiveAccount() || app.getAllAccounts()[0] || null;
}

/* There is deliberately no signOut(). The board never signs anybody out: the
   session belongs to Teams and to the Microsoft sign-in behind it, and the one
   control that used to end it here has been removed. Re-adding one means
   re-adding the Teams special case too — logoutPopup is a popup, which Teams
   refuses, so it would have to clear the MSAL cache instead. */

async function token() {
  const app = await msal();
  const account = await currentAccount();
  if (!account) throw new Error("Not signed in");
  try {
    const r = await app.acquireTokenSilent({ scopes: SCOPES, account });
    return r.accessToken;
  } catch {
    /* An expired token cannot be renewed silently inside Teams, because the
       hidden-iframe renewal MSAL uses is blocked in a nested frame. Send the
       person back through the Teams window instead of a popup. */
    if (await inTeams()) {
      await teamsSignIn();
      const r = await app.acquireTokenSilent({
        scopes: SCOPES,
        account: app.getActiveAccount(),
      });
      return r.accessToken;
    }
    const r = await app.acquireTokenPopup({ scopes: SCOPES, account });
    return r.accessToken;
  }
}

/* ------------------------------ Graph --------------------------------- */

async function graph(path, init = {}, tries = 0) {
  const t = await token();
  const url = path.startsWith("http") ? path : GRAPH + path;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if ((res.status === 429 || res.status >= 500) && tries < 4) {
    /* Retry-After can be an HTTP-date, which Number() turns into NaN — the
       fallback must sit outside the cast or the wait collapses to 0 and a
       throttled tenant gets hammered. Capped so a persistent 500 fails into
       the error path instead of wedging the save pill on "Saving…" forever. */
    const wait = (Number(res.headers.get("Retry-After")) || 2) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return graph(path, init, tries + 1);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph ${res.status} on ${path} — ${body.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

/* ---- activity notifications (item 12) ----
   Teams activity-feed pings, sent from the acting user's session with the
   delegated TeamsActivity.Send scope — no server (decisions.md). Best
   effort by design: a failed send is logged and swallowed, never blocks
   the board. Every activityType used here must also be declared in the
   Teams app manifest ("activities" section) and the app package
   republished, or Graph rejects the send. */

/* Operator is a role, not a per-job field: the Entra user ids pinged when
   a new job lands in staging. Empty until the shop hires a dedicated
   operator — a designer is acting operator and raises the jobs anyway. */
const OPERATOR_NOTIFY_IDS = [];

async function sendActivityPings({ activityType, preview, jobName, userIds }) {
  try {
    if (!configured() || !(await inTeams())) return;
    const ctx = await window.microsoftTeams.app.getContext();
    const teamId = ctx?.team?.groupId;
    if (!teamId) return; // not in a team channel — nowhere to send from
    /* the person performing the action never needs to be told about it */
    const actor = (ctx?.user?.id || "").toLowerCase();
    const targets = [
      ...new Set(userIds.filter(Boolean).map((s) => s.toLowerCase())),
    ].filter((id) => id !== actor);
    await Promise.all(
      targets.map((userId) =>
        graph(`/teams/${teamId}/sendActivityNotification`, {
          method: "POST",
          body: JSON.stringify({
            topic: { source: "entityUrl", value: `${GRAPH}/teams/${teamId}` },
            activityType,
            previewText: { content: preview },
            recipient: {
              "@odata.type": "microsoft.graph.aadUserNotificationRecipient",
              userId,
            },
            templateParameters: [{ name: "jobName", value: jobName }],
          }),
        })
      )
    );
  } catch (e) {
    console.warn("Activity notification not sent", e);
  }
}

/* Same promise-memo shape as msal(): the three parallel readLists in
   loadLists all hit this before the first lookup lands, so caching the
   resolved value fired three identical site lookups per load and per poll.
   A failed lookup clears the memo rather than poisoning every retry. */
let siteIdPromise = null;
const siteId = () =>
  (siteIdPromise ??= graph(`/sites/${SP.hostname}:${SP.sitePath}`).then(
    (site) => site.id,
    (err) => {
      siteIdPromise = null;
      throw err;
    }
  ));

async function readList(list) {
  const sid = await siteId();
  let next = `/sites/${sid}/lists/${list}/items?$expand=fields&$top=500`;
  const rows = [];
  while (next) {
    const page = await graph(next);
    rows.push(...page.value);
    next = page["@odata.nextLink"] || null;
  }
  return rows;
}

const createItem = async (list, fields) =>
  graph(`/sites/${await siteId()}/lists/${list}/items`, {
    method: "POST",
    body: JSON.stringify({ fields }),
  });

const patchItem = async (list, itemId, fields) =>
  graph(`/sites/${await siteId()}/lists/${list}/items/${itemId}/fields`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });

const deleteItem = async (list, itemId) =>
  graph(`/sites/${await siteId()}/lists/${list}/items/${itemId}`, {
    method: "DELETE",
  });

/* ------------------- rows in, rows out (per list) --------------------- */

const str = (v) => (v === undefined || v === null ? "" : String(v));
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/* EtaDate is a real Date and Time column, so it round-trips through ISO
   rather than staying the "YYYY-MM-DD" string the date input produces.
   We write noon UTC, not midnight: midnight UTC displays as the previous
   evening anywhere west of Greenwich, so the SharePoint list itself would
   show jobs due a day early. Noon keeps the date intact either way.
   EtaTime stays a plain text column and needs no conversion. */
const dateToIso = (ymd) =>
  /^\d{4}-\d{2}-\d{2}$/.test(ymd || "") ? `${ymd}T12:00:00Z` : null;

const isoToDate = (iso) => (iso ? String(iso).slice(0, 10) : "");

/* CreatedAt/CompletedAt (stamped in PrintFarmScheduler via nowIso()) are a
   different kind of date from EtaDate/NeedByDate: real machine-set instants,
   not a date-input string, so the noon-UTC fudge above doesn't apply and
   would only throw away the time of day. Round-trip the ISO string as-is. */

/* All three fromRow mappers fall back to the SharePoint row id when the app's
   uuid cell is blank (hand-added row, failed first write). It must be a STABLE
   fallback — minting uid() here gave the row a new identity on every poll, so
   mergeList saw a delete+create each tick and itemIds leaked a key per poll. */
const groupFromRow = (f, row) => ({
  id: str(f[COLS.groups.uuid]) || str(row?.id) || uid(),
  name: str(f[COLS.groups.name]),
  color: str(f[COLS.groups.color]) || GROUP_COLORS[0],
  collapsed: false,
  sortOrder: num(f[COLS.groups.sortOrder]),
});

const groupToRow = (g) => ({
  [COLS.groups.uuid]: g.id,
  [COLS.groups.name]: g.name,
  [COLS.groups.color]: g.color,
  [COLS.groups.sortOrder]: num(g.sortOrder),
});

const printerFromRow = (f, row) => ({
  id: str(f[COLS.printers.uuid]) || str(row?.id) || uid(),
  name: str(f[COLS.printers.name]),
  groupId: str(f[COLS.printers.groupId]),
  status: str(f[COLS.printers.status]) || "Ready",
  sortOrder: num(f[COLS.printers.sortOrder]),
  settings: {
    notes: str(f[COLS.printers.notes]),
    printMaterialOther: str(f[COLS.printers.printMaterialOther]),
    fields: PRINTER_FIELDS.reduce((acc, pf) => {
      acc[pf.key] = str(f[pf.column]) || DEFAULT_PRINTER_FIELDS[pf.key];
      return acc;
    }, {}),
  },
});

const printerToRow = (p) => ({
  [COLS.printers.uuid]: p.id,
  [COLS.printers.name]: p.name,
  [COLS.printers.groupId]: p.groupId,
  [COLS.printers.status]: p.status,
  [COLS.printers.notes]: p.settings?.notes || "",
  [COLS.printers.printMaterialOther]: p.settings?.printMaterialOther || "",
  [COLS.printers.sortOrder]: num(p.sortOrder),
  ...PRINTER_FIELDS.reduce((acc, pf) => {
    acc[pf.column] = p.settings?.fields?.[pf.key] || "";
    return acc;
  }, {}),
});

/* Tolerates hand-edited or blank NotifyPeople cells — anything that
   isn't a JSON array reads as "nobody extra". */
const parsePeople = (s) => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

/* The second argument is the whole Graph list item, not fields — createdBy
   lives on the row root. The creator's Entra id feeds the job-start ping
   (item 12) and is deliberately not stored in any app column: SharePoint's
   own author record is the source of truth. Rows created locally this
   session have no createdById, which is fine — their creator is this
   signed-in user, who as the acting party is skipped anyway. */
const taskFromRow = (f, row) => ({
  createdById: str(row?.createdBy?.user?.id),
  id: str(f[COLS.tasks.uuid]) || str(row?.id) || uid(),
  printerId: str(f[COLS.tasks.printerId]) || STAGING,
  parentId: str(f[COLS.tasks.parentId]),
  title: str(f[COLS.tasks.title]),
  jobcode: str(f[COLS.tasks.jobcode]),
  notes: str(f[COLS.tasks.notes]),
  operatorNotes: str(f[COLS.tasks.operatorNotes]),
  status: str(f[COLS.tasks.status]) || "Not started",
  priority: str(f[COLS.tasks.priority]) || "Normal",
  sliceStatus: str(f[COLS.tasks.sliceStatus]) || "Not Sliced",
  quantity: num(f[COLS.tasks.quantity], 1),
  etaDate: isoToDate(f[COLS.tasks.etaDate]),
  etaTime: str(f[COLS.tasks.etaTime]),
  needByDate: isoToDate(f[COLS.tasks.needByDate]),
  sentBy: str(f[COLS.tasks.sentBy]),
  giveTo: str(f[COLS.tasks.giveTo]),
  notifyPeople: parsePeople(str(f[COLS.tasks.notifyPeople])),
  filepath: str(f[COLS.tasks.filepath]),
  printQuality: str(f[COLS.tasks.printQuality]) || "Medium",
  printStrength: str(f[COLS.tasks.printStrength]) || "Standard",
  printMaterial: str(f[COLS.tasks.printMaterial]) || "ABS",
  sortOrder: num(f[COLS.tasks.sortOrder]),
  createdAt: str(f[COLS.tasks.createdAt]),
  completedAt: str(f[COLS.tasks.completedAt]),
});

const taskToRow = (t) => ({
  [COLS.tasks.uuid]: t.id,
  [COLS.tasks.printerId]: t.printerId || STAGING,
  [COLS.tasks.parentId]: t.parentId || "",
  [COLS.tasks.title]: t.title || "",
  [COLS.tasks.jobcode]: t.jobcode || "",
  [COLS.tasks.notes]: t.notes || "",
  [COLS.tasks.operatorNotes]: t.operatorNotes || "",
  [COLS.tasks.status]: t.status || "Not started",
  [COLS.tasks.priority]: t.priority || "Normal",
  [COLS.tasks.sliceStatus]: t.sliceStatus || "Not Sliced",
  [COLS.tasks.quantity]: num(t.quantity, 1),
  [COLS.tasks.etaDate]: dateToIso(t.etaDate),
  [COLS.tasks.etaTime]: t.etaTime || "",
  [COLS.tasks.needByDate]: dateToIso(t.needByDate),
  [COLS.tasks.sentBy]: t.sentBy || "",
  [COLS.tasks.giveTo]: t.giveTo || "",
  [COLS.tasks.notifyPeople]: t.notifyPeople?.length
    ? JSON.stringify(t.notifyPeople)
    : "",
  [COLS.tasks.filepath]: t.filepath || "",
  [COLS.tasks.printQuality]: t.printQuality || "Medium",
  [COLS.tasks.printStrength]: t.printStrength || "Standard",
  [COLS.tasks.printMaterial]: t.printMaterial || "ABS",
  [COLS.tasks.sortOrder]: num(t.sortOrder),
  [COLS.tasks.createdAt]: t.createdAt || null,
  [COLS.tasks.completedAt]: t.completedAt || null,
});

const LISTS = {
  groups: { name: "Groups", fromRow: groupFromRow, toRow: groupToRow },
  printers: { name: "Printers", fromRow: printerFromRow, toRow: printerToRow },
  tasks: { name: "Tasks", fromRow: taskFromRow, toRow: taskToRow },
};

/* --------------------------- initial load ----------------------------- */

/* Dropdown options come from the SharePoint choice columns so the shop can
   edit them without a code change. A failed read keeps the built-in list —
   a stale dropdown beats an empty one. */
async function loadChoices(colsByList) {
  const out = { ...DEFAULT_CHOICES };
  try {
    /* Column metadata comes from checkSchema's read — same payload, no
       second round-trip. Keyed by list, not just by column name: Printers
       and Tasks both have a PrintMaterial column and they are deliberately
       different lists — a flat map would let whichever list was read last
       silently win. */
    const byList = {};
    for (const list of ["Printers", "Tasks"]) {
      byList[list] = {};
      for (const c of colsByList?.[list] || []) {
        if (c.choice?.choices?.length) byList[list][c.name] = c.choice.choices;
      }
    }
    for (const pf of PRINTER_FIELDS) {
      if (byList.Printers[pf.column]) out[pf.key] = byList.Printers[pf.column];
    }
    if (byList.Tasks.PrintQuality) out.printQuality = byList.Tasks.PrintQuality;
    if (byList.Tasks.PrintStrength) out.printStrength = byList.Tasks.PrintStrength;
    if (byList.Tasks.PrintMaterial) out.taskPrintMaterial = byList.Tasks.PrintMaterial;
  } catch (err) {
    console.warn("Choice columns unreadable, using built-in defaults.", err);
  }
  return out;
}

/* Settings is a key/value list. A missing key falls back to the code
   default rather than erroring, so a deleted row degrades gracefully.

   A FAILED read must not be swallowed like a missing key: returning defaults
   without registering itemIds means the next settings change takes the create
   branch and duplicates rows for keys that already exist. Let the error reach
   the load screen, which has a Try again button. */
async function loadSettings(itemIds) {
  const out = { ...DEFAULT_APP_SETTINGS };
  const rows = await readList("Settings");
  for (const row of rows) {
    const key = str(row.fields?.Title);
    if (!(key in out)) continue;
    itemIds.set(`settings:${key}`, row.id);
    const raw = str(row.fields?.Value);
    out[key] = typeof out[key] === "number" ? num(raw, out[key]) : raw || out[key];
  }
  return out;
}

/* ---------------------------------------------------------------------
   Schema check.

   SharePoint fixes a column's internal name when the column is created
   and never changes it afterwards, so a column displayed as "Status" can
   answer to something else entirely — a space becomes _x0020_, and a
   name reused after a delete picks up a trailing digit. Rather than
   discover that one failed save at a time, compare every name in COLS
   against the live lists on load and report all mismatches together.
   --------------------------------------------------------------------- */
/* Returns the raw column arrays by list so loadChoices can reuse them
   instead of re-fetching the same payload. */
async function checkSchema() {
  const sid = await siteId();
  const problems = [];
  const colsByList = {};

  const expected = {
    Groups: Object.values(COLS.groups),
    Printers: [
      ...Object.values(COLS.printers),
      ...PRINTER_FIELDS.map((f) => f.column),
    ],
    Tasks: Object.values(COLS.tasks),
    Settings: ["Title", "Value"],
  };

  for (const [list, names] of Object.entries(expected)) {
    let actual;
    try {
      const res = await graph(`/sites/${sid}/lists/${list}/columns`);
      colsByList[list] = res.value || [];
      actual = colsByList[list].filter((c) => !c.readOnly).map((c) => c.name);
    } catch {
      problems.push(`${list}: list not found on the site.`);
      continue;
    }
    const missing = names.filter((n) => !actual.includes(n));
    if (missing.length) {
      problems.push(
        `${list} — the app expects ${missing.join(", ")}, but the list has: ${actual.join(", ")}`
      );
    }
  }

  if (problems.length) {
    throw new Error(
      "Column names don't line up. Fix the COLS block near the bottom of " +
        "print-farm-scheduler.jsx so each entry matches the internal name " +
        "on the right.\n\n" +
        problems.join("\n\n")
    );
  }
  return colsByList;
}

/* The three data lists, mapped and registered in itemIds. Shared by the
   initial load and the live-refresh poll (item 11) — the poll deliberately
   skips checkSchema, choices and settings: the schema can't change
   mid-session, and the other two are rare edits a reload picks up. */
async function loadLists(itemIds) {
  const [groupRows, printerRows, taskRows] = await Promise.all([
    readList(LISTS.groups.name),
    readList(LISTS.printers.name),
    readList(LISTS.tasks.name),
  ]);

  const collect = (rows, spec, kind) =>
    hydrate(
      rows.map((row) => {
        const rec = spec.fromRow(row.fields || {}, row);
        itemIds.set(`${kind}:${rec.id}`, row.id);
        return rec;
      })
    );

  return {
    groups: collect(groupRows, LISTS.groups, "groups"),
    printers: collect(printerRows, LISTS.printers, "printers"),
    tasks: collect(taskRows, LISTS.tasks, "tasks"),
  };
}

async function loadEverything(itemIds) {
  const colsByList = await checkSchema();
  const lists = await loadLists(itemIds);
  const [choices, appSettings] = await Promise.all([
    loadChoices(colsByList),
    loadSettings(itemIds),
  ]);

  return { ...lists, choices, appSettings };
}

/* ------------------------------ saving -------------------------------- */

/* Reference comparison, which is only sound because reindex() and every
   mutation handler copy the rows they change and leave the rest alone. */
const sameRow = (a, b) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (String(a[k] ?? "") !== String(b[k] ?? "")) return false;
  return true;
};

/* ---- live refresh merge (item 11) ----
   Fold a fresh read of a list into what's on screen. Only ever called when
   the save layer is fully idle (nothing pending, nothing in flight), so
   the local rows ARE the saved baseline; the poll in AppShell enforces
   that. Returns {state, saved}:

   - a row unchanged remotely keeps its LOCAL object, so identity-based
     diffing and memoized components see nothing;
   - a row changed remotely is adopted with the SAME object in both arrays,
     so the follow-up persist pass diffs it as untouched — a poll must
     never cause a write;
   - a protected row (open in the modal, mid-drag) is left exactly as it
     is locally, adopted on a later poll once the person lets go;
   - a row deleted remotely goes — unless protected, in which case it stays
     on screen and is left OUT of `saved`, so the next flush re-creates it:
     the person actively working on a row wins over the person who deleted
     it.

   `carry` lets a caller keep a local-only field on adopted rows (group
   collapse). If nothing changed, both returns are the original array, so
   setState bails out and no persist pass runs at all. */
function mergeList(local, remote, protectedIds, toRow, carry = null) {
  const localById = new Map(local.map((r) => [r.id, r]));
  const state = [];
  const saved = [];
  for (const rr of remote) {
    const lr = localById.get(rr.id);
    if (lr) localById.delete(rr.id);
    let row;
    if (!lr) row = rr;
    else if (protectedIds.has(rr.id)) row = lr;
    else if (sameRow(toRow(lr), toRow(rr))) row = lr;
    else row = carry ? carry(lr, rr) : rr;
    state.push(row);
    saved.push(row);
  }
  for (const lr of localById.values())
    if (protectedIds.has(lr.id)) state.push(lr);
  /* state and saved can diverge independently: a protected row surviving a
     remote deletion changes `saved` (it must leave the baseline so a later
     flush re-creates it) while `state` stays identical. Judge each on its
     own, or the stale baseline would keep the deleted row and no
     re-creation would ever fire. */
  const differs = (arr) =>
    arr.length !== local.length || arr.some((r, i) => r !== local[i]);
  return {
    state: differs(state) ? state : local,
    saved: differs(saved) ? saved : local,
  };
}

function diffByIdentity(prev, next) {
  const before = new Map(prev.map((r) => [r.id, r]));
  const after = new Map(next.map((r) => [r.id, r]));
  const created = next.filter((r) => !before.has(r.id));
  const deleted = prev.filter((r) => !after.has(r.id));
  const updated = next.filter((r) => before.has(r.id) && before.get(r.id) !== r);
  return { created, updated, deleted, before };
}

async function saveList(kind, prev, next, itemIds) {
  const spec = LISTS[kind];
  const { created, updated, deleted, before } = diffByIdentity(prev, next);
  let writes = 0;

  for (const rec of created) {
    /* On a retry after a partially-failed flush, `prev` is still the old
       baseline (it only advances when the whole snapshot lands), so a row
       created by the failed attempt diffs as "created" again. itemIds
       remembers it — patch instead of minting a duplicate SharePoint row. */
    const existing = itemIds.get(`${kind}:${rec.id}`);
    if (existing) {
      await patchItem(spec.name, existing, spec.toRow(rec));
    } else {
      const row = await createItem(spec.name, spec.toRow(rec));
      itemIds.set(`${kind}:${rec.id}`, row.id);
    }
    writes++;
  }
  for (const rec of updated) {
    const itemId = itemIds.get(`${kind}:${rec.id}`);
    const row = spec.toRow(rec);
    if (itemId) {
      /* A row can be a new object without any stored column differing —
         toggling a group's collapse is view state, not shop state. Compare
         the mapped row so those changes cost nothing. */
      const beforeRow = spec.toRow(before.get(rec.id));
      if (sameRow(beforeRow, row)) continue;
      await patchItem(spec.name, itemId, row);
      writes++;
    } else {
      const created_ = await createItem(spec.name, row);
      itemIds.set(`${kind}:${rec.id}`, created_.id);
      writes++;
    }
  }
  for (const rec of deleted) {
    const itemId = itemIds.get(`${kind}:${rec.id}`);
    if (itemId) {
      await deleteItem(spec.name, itemId);
      itemIds.delete(`${kind}:${rec.id}`);
      writes++;
    }
  }
  return writes;
}

async function saveSettings(prev, next, itemIds) {
  let n = 0;
  for (const key of Object.keys(DEFAULT_APP_SETTINGS)) {
    if (String(prev[key]) === String(next[key])) continue;
    const itemId = itemIds.get(`settings:${key}`);
    if (itemId) await patchItem("Settings", itemId, { Value: String(next[key]) });
    else {
      const row = await createItem("Settings", {
        Title: key,
        Value: String(next[key]),
      });
      itemIds.set(`settings:${key}`, row.id);
    }
    n++;
  }
  return n;
}

/* ------------------------- shell + save status ------------------------- */

const SAVE_DEBOUNCE_MS = 700;

/* item 11. 60s balances freshness against Graph throttling with 10–15
   tabs open: three list reads per tick per client. */
const LIVE_POLL_MS = 60_000;

/* Save status only — no identity, and nothing to action.

   The board cannot run outside a signed-in Teams session, and Teams logins
   here are persistent per machine with no machine shared between people. So
   who you are is already settled before the tab loads: there was nothing for
   a Sign out button to usefully do except break your own session with no way
   back, and nothing for an account name to tell you that you did not already
   know. Both are gone. See docs/authentication.md#there-is-no-sign-out. */
function StatusPill({ state, detail, onRetry }) {
  const look = {
    saving: { bg: "#FFF4CE", fg: "#7A5B00", text: "Saving…" },
    saved: { bg: "#DFF6DD", fg: "#0E5814", text: "Saved" },
    error: { bg: "#FDE7E9", fg: "#A4262C", text: "Not saved" },
  }[state] || { bg: "#F3F2F1", fg: "#605E5C", text: "" };

  return (
    <div
      className="fixed bottom-3 right-3 z-40 flex items-center gap-2 rounded-full px-3 py-1.5 shadow-sm"
      style={{ background: look.bg, color: look.fg, fontSize: 11 }}
      title={detail || ""}
    >
      <span className="font-semibold">{look.text}</span>
      {state === "error" && (
        <button onClick={onRetry} className="underline font-semibold">
          Retry
        </button>
      )}
    </div>
  );
}

function Centered({ children }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: "#F3F2F1" }}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-sm"
        style={{ border: "1px solid #E1DFDD" }}
      >
        {children}
      </div>
    </div>
  );
}

function AppShell() {
  const [phase, setPhase] = useState(configured() ? "checking" : "ready");
  const [initial, setInitial] = useState(null);
  const [account, setAccount] = useState(null);
  const [error, setError] = useState(null);
  const [saveState, setSaveState] = useState(null);
  const [saveDetail, setSaveDetail] = useState("");

  const itemIds = useRef(new Map());        // "kind:uuid" → SharePoint item id
  const saved = useRef(null);               // last snapshot written
  const pending = useRef(null);             // newest snapshot awaiting write
  const writing = useRef(false);
  const liveApi = useRef(null);             // the board's applyRemote (item 11)

  /* already signed in from an earlier tab? skip the button */
  useEffect(() => {
    if (!configured()) return;
    (async () => {
      try {
        const acct = await silentSignIn();
        if (acct) {
          setAccount(acct);
          await load();
        } else {
          setPhase("signin");
        }
      } catch {
        setPhase("signin");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    setPhase("loading");
    setError(null);
    try {
      const data = await loadEverything(itemIds.current);
      saved.current = {
        groups: data.groups,
        printers: data.printers,
        tasks: data.tasks,
        appSettings: data.appSettings,
      };
      setInitial(data);
      setPhase("ready");
    } catch (err) {
      setError(err.message || String(err));
      setPhase("error");
    }
  };

  const doSignIn = async () => {
    setPhase("loading");
    try {
      const acct = await signIn();
      setAccount(acct);
      await load();
    } catch (err) {
      setError(err.message || String(err));
      setPhase("error");
    }
  };

  /* One writer at a time. Anything that lands mid-write is coalesced into
     `pending` and written once the current pass finishes, so a burst of
     drags collapses into a single trailing save. */
  const flush = async () => {
    if (writing.current || !pending.current) return;
    writing.current = true;
    setSaveState("saving");
    let inFlight = null;
    try {
      while (pending.current) {
        inFlight = pending.current;
        pending.current = null;
        const prev = saved.current;
        let n = 0;
        n += await saveList("groups", prev.groups, inFlight.groups, itemIds.current);
        n += await saveList("printers", prev.printers, inFlight.printers, itemIds.current);
        n += await saveList("tasks", prev.tasks, inFlight.tasks, itemIds.current);
        n += await saveSettings(prev.appSettings, inFlight.appSettings, itemIds.current);
        saved.current = inFlight;
        inFlight = null;
        setSaveDetail(n ? `${n} change${n === 1 ? "" : "s"} written` : "");
      }
      setSaveState("saved");
    } catch (err) {
      console.error(err);
      setSaveDetail(err.message || String(err));
      setSaveState("error");
      /* The snapshot that failed was already cleared from `pending` before the
         attempt, so Retry would otherwise find nothing to do. Put it back —
         unless a newer edit already landed in `pending` while this write was
         in flight, in which case that snapshot supersedes it and must not be
         clobbered. */
      if (inFlight && !pending.current) pending.current = inFlight;
    } finally {
      writing.current = false;
    }
  };

  const onPersist = useMemo(() => {
    if (!configured()) return null;
    let timer = null;
    return (snapshot) => {
      pending.current = snapshot;
      setSaveState((s) => (s === "error" ? s : "saving"));
      clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- live refresh (item 11) ----
     Poll the lists and fold other people's changes into the board. Only
     when this client is fully idle — nothing pending, nothing in flight —
     which is what lets mergeList treat local state as the saved baseline.
     The idle check runs again after the fetch, because a save can start
     while the read is on the wire; a stale read is discarded, never
     merged. A hidden tab doesn't poll (Teams keeps backgrounded tabs
     alive for a long time), but coming back to the tab polls at once.
     A failed poll is logged and skipped — the next tick retries, and
     graph() already backs off on 429; the interval is sized for 10–15
     clients sharing the tenant's throttling budget. */
  useEffect(() => {
    if (!configured() || phase !== "ready") return;
    let stopped = false;
    const tick = async () => {
      if (
        stopped ||
        document.hidden ||
        writing.current ||
        pending.current ||
        !liveApi.current
      )
        return;
      try {
        const remote = await loadLists(itemIds.current);
        if (stopped || writing.current || pending.current) return;
        liveApi.current.applyRemote(remote, (baseline) => {
          saved.current = baseline;
        });
      } catch (err) {
        console.warn("Live refresh skipped", err);
      }
    };
    const iv = setInterval(tick, LIVE_POLL_MS);
    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [phase]);

  /* last-ditch warning if someone closes the tab mid-write */
  useEffect(() => {
    const warn = (e) => {
      if (pending.current || writing.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  if (phase === "signin")
    return (
      <Centered>
        <h1 className="text-lg font-semibold" style={{ color: "#201F1E" }}>
          Print Farm Scheduler
        </h1>
        <p className="mt-1 mb-4 text-sm" style={{ color: "#605E5C" }}>
          Sign in with your work account to load the board.
          {/* also stamped here: a tab that never gets past sign-in still needs
              to be able to say which code it is running */}
          <span className="block mt-1 text-xs" style={{ color: "#8A8886" }}>
            v{APP_VERSION} · build {BUILD}
          </span>
        </p>
        <button
          onClick={doSignIn}
          className="w-full rounded py-2 text-sm font-medium text-white"
          style={{ background: "#0F6CBD" }}
        >
          Sign in
        </button>
      </Centered>
    );

  if (phase === "checking")
    return (
      <Centered>
        <p className="text-sm" style={{ color: "#605E5C" }}>
          Checking your sign-in…
        </p>
      </Centered>
    );

  if (phase === "loading")
    return (
      <Centered>
        <p className="text-sm" style={{ color: "#605E5C" }}>
          Loading the board…
        </p>
      </Centered>
    );

  if (phase === "error")
    return (
      <Centered>
        <h1 className="text-base font-semibold" style={{ color: "#A4262C" }}>
          Could not load the board
        </h1>
        <p
          className="mt-2 mb-4 text-xs whitespace-pre-wrap"
          style={{ color: "#605E5C" }}
        >
          {error}
        </p>
        <button
          onClick={account ? load : doSignIn}
          className="w-full rounded py-2 text-sm font-medium text-white"
          style={{ background: "#0F6CBD" }}
        >
          Try again
        </button>
      </Centered>
    );

  return (
    <>
      <PrintFarmScheduler initial={initial} onPersist={onPersist} liveApi={liveApi} />
      {configured() && (
        <StatusPill
          state={saveState}
          detail={saveDetail}
          onRetry={flush}
        />
      )}
    </>
  );
}

/* ---------------------------------------------------------------------
   Browser mount. Harmless when this file is imported as a component
   module — it only runs if a #root element exists on the page.
   --------------------------------------------------------------------- */
const rootEl =
  typeof document !== "undefined" && document.getElementById("root");
if (rootEl) createRoot(rootEl).render(<AppShell />);
