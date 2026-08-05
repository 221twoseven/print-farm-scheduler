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

/* Group colors are assigned automatically and uniquely; printers inherit
   their group's color and it is not individually assignable. */
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
  { key: "printMaterial", label: "Print material", column: "PrintMaterial" },
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
  printMaterial: ["ABS", "Other (Discuss with Operator)"],
  printQuality: ["Draft", "Medium", "High"],
  printStrength: ["Structural", "Standard", "Aesthetic"],
};

/* A row written before a choice was removed still holds the old value.
   Keep it in the dropdown so the field doesn't silently read as blank. */
const optionsFor = (list, current) => {
  const opts = list || [];
  return current && !opts.includes(current) ? [...opts, current] : opts;
};

const defaultPrinterFields = () => ({
  nozzleSize: "0.4mm",
  nozzleType: "Standard",
  nozzleMaterial: "Standard",
  bedType: "Textured",
  printMaterial: "ABS",
});

/* Global task tag — same dropdown choices across all tasks */
const TASK_TAGS = ["Sliced", "Not Sliced", "Needs Nesting"];
/* only the dot color is used, in the context menu */
const SLICE_DOT = {
  Sliced: "#498205",
  "Not Sliced": "#8A8886",
  "Needs Nesting": "#CA5010",
};

/* Printer state — one control, three states. Replaces the old on/off toggle
   plus availability pill, which between them produced four states when only
   three mean anything. Stored as the Status choice column in the Printers
   list (Active and Available are no longer used).
     accepts  can new work be dropped / added here
     evicts   does entering this state send queued jobs back to staging
     dim      is the card greyed out — reserved for "cannot print at all" */
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

const STATUSES = ["Not started", "In progress", "Complete"];

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
        fields: { nozzleSize: "0.6mm", nozzleType: "High Flow", nozzleMaterial: "Standard", bedType: "Textured", printMaterial: "ABS" },
        notes: "",
      },
    },
    {
      id: "p3",
      name: "XL — Charlie",
      groupId: "g2",
      status: "Maintenance",
      settings: {
        fields: { nozzleSize: "0.8mm", nozzleType: "High Flow", nozzleMaterial: "Tungsten", bedType: "Textured", printMaterial: "Other (Discuss with Operator)" },
        notes: "Down for hotend service until parts arrive.",
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
      status: "In progress",
      etaDate: "2026-06-15",
      etaTime: "14:30",
      sliceStatus: "Sliced",
      sentBy: "Dana",
      giveTo: "Assembly",
      filepath: "\\\\farm\\queue\\bracket_set_x12.3mf",
      quantity: 12,
      priority: "High",
    },
    {
      id: "t2",
      printerId: "p1",
      title: "Enclosure vents v3",
      status: "Not started",
      etaDate: "2026-06-19",
      etaTime: "09:00",
      sliceStatus: "Needs Nesting",
      sentBy: "Marco",
      giveTo: "QA",
    },
    {
      id: "t3",
      printerId: "p2",
      title: "Jig plates — batch 2",
      status: "In progress",
      etaDate: "2026-06-13",
      etaTime: "17:00",
      sliceStatus: "Sliced",
      sentBy: "Priya",
      giveTo: "Dana",
    },
    {
      id: "t5",
      printerId: STAGING,
      title: "Prototype housing rev B",
      status: "Not started",
      etaDate: "2026-06-20",
      etaTime: "10:00",
      sliceStatus: "Not Sliced",
      sentBy: "Front desk",
      giveTo: "",
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
      status: "Not started",
      etaDate: "",
      etaTime: "",
      sliceStatus: slice[i % slice.length],
      sentBy: people[i % people.length],
      giveTo: people[(i + 3) % people.length],
      quantity: (i % 5) + 1,
      priority: prios[i % prios.length],
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

/* ------------------------------- app ---------------------------------- */

export default function PrintFarmScheduler() {
  /* hydrate() is the entry point storage rows will use too */
  const [groups, setGroups] = useState(() => hydrate(seedGroups));
  const [printers, setPrinters] = useState(() => hydrate(seedPrinters));
  const [tasks, setTasks] = useState(() => hydrate(seedTasks));
  const [appSettings, setAppSettings] = useState(DEFAULT_APP_SETTINGS);
  /* PERSISTENCE SEAM: replace with the choice columns read from SharePoint
     on sign-in, so equipment options are editable without a code change. */
  const [choices, setChoices] = useState(DEFAULT_CHOICES);

  const [openSettings, setOpenSettings] = useState({});
  const [addingTaskIn, setAddingTaskIn] = useState(null); // printerId or STAGING
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [removeGroupMode, setRemoveGroupMode] = useState(false);
  const [showShopSettings, setShowShopSettings] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // {type, id, x, y}
  const [draggingTaskId, setDraggingTaskId] = useState(null);
  const [confirm, setConfirm] = useState(null); // {title, body, confirmLabel, onConfirm}

  const groupColor = (groupId) =>
    groups.find((g) => g.id === groupId)?.color || "#69797E";

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

  const stagingTasks = tasksByPrinter[STAGING] || [];

  /* printers with in-progress tasks, for the status bar */
  const inProgressPrinters = useMemo(() => {
    const counts = {};
    tasks.forEach((t) => {
      if (t.status === "In progress" && t.printerId !== STAGING) {
        counts[t.printerId] = (counts[t.printerId] || 0) + 1;
      }
    });
    return printers
      .filter((p) => counts[p.id])
      .map((p) => ({ ...p, count: counts[p.id], color: groupColor(p.groupId) }));
  }, [tasks, printers, groups]);

  const expandedTask = tasks.find((t) => t.id === expandedTaskId) || null;

  /* ------------------------- mutations -------------------------------- */

  /* any structural task change renumbers sortOrder within its printer */
  const setTasksOrdered = (fn) =>
    setTasks((ts) => reindex(fn(ts), (t) => t.printerId));

  const updatePrinter = (id, patch) =>
    setPrinters((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const updatePrinterSettings = (id, patch) =>
    setPrinters((ps) =>
      ps.map((p) =>
        p.id === id ? { ...p, settings: { ...p.settings, ...patch } } : p
      )
    );

  const updatePrinterField = (id, key, value) =>
    setPrinters((ps) =>
      ps.map((p) =>
        p.id === id
          ? { ...p, settings: { ...p.settings, fields: { ...p.settings.fields, [key]: value } } }
          : p
      )
    );

  /* moving a printer to Maintenance sends its queued jobs back to staging */
  const setPrinterStatus = (id, status) => {
    updatePrinter(id, { status });
    if (PRINTER_STATUS[status]?.evicts) {
      setTasksOrdered((ts) =>
        ts.map((t) => (t.printerId === id ? { ...t, printerId: STAGING } : t))
      );
    }
  };

  /* only a Ready printer takes new work */
  const acceptsTasks = (printerId) => {
    if (printerId === STAGING) return true;
    const p = printers.find((x) => x.id === printerId);
    return !!p && PRINTER_STATUS[p.status]?.accepts;
  };

  const updateTask = (id, patch) =>
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const deleteTask = (id) => {
    setTasksOrdered((ts) => ts.filter((t) => t.id !== id));
    setExpandedTaskId((cur) => (cur === id ? null : cur));
  };

  /* drop on a column's open area: move to that printer, at the end */
  const moveTask = (taskId, destPrinterId) => {
    setDraggingTaskId(null);
    if (!acceptsTasks(destPrinterId)) return;
    const source = tasks.find((t) => t.id === taskId);
    setTasksOrdered((ts) => {
      const dragged = ts.find((t) => t.id === taskId);
      if (!dragged) return ts;
      const without = ts.filter((t) => t.id !== taskId);
      return [...without, { ...dragged, printerId: destPrinterId }];
    });
    /* newly assigned from staging → open the editor so ETA/status get set */
    if (source && source.printerId === STAGING && destPrinterId !== STAGING) {
      setExpandedTaskId(taskId);
    }
  };

  /* drop onto a specific card: insert before/after it */
  const moveTaskRelative = (taskId, targetTaskId, position) => {
    setDraggingTaskId(null);
    if (taskId === targetTaskId) return;
    const source = tasks.find((t) => t.id === taskId);
    const targetNow = tasks.find((t) => t.id === targetTaskId);
    if (!targetNow || !acceptsTasks(targetNow.printerId)) return;
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
    if (source && source.printerId === STAGING && targetNow.printerId !== STAGING) {
      setExpandedTaskId(taskId);
    }
  };

  /* duplicate a task in place; copies always reset to Not started */
  const copyTask = (taskId) => {
    setTasksOrdered((ts) => {
      const idx = ts.findIndex((t) => t.id === taskId);
      if (idx === -1) return ts;
      const copy = {
        ...ts[idx],
        id: uid(),
        title: `${ts[idx].title} (copy)`,
        status: "Not started",
      };
      return [...ts.slice(0, idx + 1), copy, ...ts.slice(idx + 1)];
    });
  };

  const addTask = (printerId, fields) => {
    setTasksOrdered((ts) => [
      ...ts,
      { id: uid(), printerId, status: "Not started", ...fields },
    ]);
    setAddingTaskIn(null);
  };

  const toggleGroup = (id) =>
    setGroups((gs) =>
      gs.map((g) => (g.id === id ? { ...g, collapsed: !g.collapsed } : g))
    );

  const renameGroup = (id, name) => {
    const clean = name.trim();
    if (clean)
      setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, name: clean } : g)));
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

  /* delete a group: remove its printers; their tasks fall back to staging */
  const deleteGroup = (groupId) => {
    const printerIds = printers
      .filter((p) => p.groupId === groupId)
      .map((p) => p.id);
    setTasksOrdered((ts) =>
      ts.map((t) =>
        printerIds.includes(t.printerId) ? { ...t, printerId: STAGING } : t
      )
    );
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
            settings: { fields: defaultPrinterFields(), notes: "" },
          },
        ],
        (p) => p.groupId
      )
    );
  };

  const deletePrinter = (id) => {
    setPrinters((ps) => reindex(ps.filter((p) => p.id !== id), (p) => p.groupId));
    setTasksOrdered((ts) =>
      ts.map((t) => (t.printerId === id ? { ...t, printerId: STAGING } : t))
    );
  };

  /* permanently remove completed jobs from a printer's history */
  const purgeDone = (printerId) => {
    setTasksOrdered((ts) =>
      ts.filter((t) => !(t.printerId === printerId && t.status === "Complete"))
    );
  };

  /* ---------------------- destructive confirmations -------------------- */

  const askDeleteGroup = (groupId) => {
    const g = groups.find((x) => x.id === groupId);
    const gp = printers.filter((p) => p.groupId === groupId);
    const affected = tasks.filter((t) => gp.some((p) => p.id === t.printerId)).length;
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
            {affected > 0 ? (
              <>
                <strong>
                  {affected} task{affected !== 1 ? "s" : ""}
                </strong>{" "}
                on {gp.length !== 1 ? "those printers" : "that printer"} move back to
                the staging area rather than being deleted.
              </>
            ) : (
              "No tasks are assigned to its printers."
            )}
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
    const affected = (tasksByPrinter[printerId] || []).length;
    setConfirm({
      title: `Delete “${p?.name}”?`,
      confirmLabel: "Delete printer",
      body: (
        <p className="text-sm" style={{ color: "#605E5C" }}>
          This permanently deletes the printer.{" "}
          {affected > 0 ? (
            <>
              Its{" "}
              <strong>
                {affected} task{affected !== 1 ? "s" : ""}
              </strong>{" "}
              move back to the staging area rather than being deleted.
            </>
          ) : (
            "It has no tasks assigned."
          )}
        </p>
      ),
      onConfirm: () => deletePrinter(printerId),
    });
  };

  const askPurgeDone = (printerId) => {
    const p = printers.find((x) => x.id === printerId);
    const done = (tasksByPrinter[printerId] || []).filter(
      (t) => t.status === "Complete"
    ).length;
    setConfirm({
      title: `Clear completed jobs on “${p?.name}”?`,
      confirmLabel: `Clear ${done} job${done !== 1 ? "s" : ""}`,
      body: (
        <p className="text-sm" style={{ color: "#605E5C" }}>
          This permanently deletes{" "}
          <strong>
            {done} completed job{done !== 1 ? "s" : ""}
          </strong>
          . They cannot be recovered.
        </p>
      ),
      onConfirm: () => purgeDone(printerId),
    });
  };

  const openTaskMenu = (e, taskId) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ type: "task", id: taskId, x: e.clientX, y: e.clientY });
  };

  const openPrinterMenu = (e, printerId) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ type: "printer", id: printerId, x: e.clientX, y: e.clientY });
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
        .pp-board-scroll { overflow-x: auto; overflow-y: visible; }
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
            Team tab · {printers.length} printers · {tasks.length} tasks
          </div>
        </div>
        <button
          onClick={() => setShowShopSettings(true)}
          className="ml-auto p-1.5 rounded hover:bg-white/15"
          title="Shop layout settings"
          aria-label="Shop layout settings"
          style={{ opacity: 0.55 }}
        >
          <Settings size={16} color="white" />
        </button>
      </header>

      {/* shop layout settings — a "set once" buried config */}
      {showShopSettings && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setShowShopSettings(false)}
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
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium" style={{ color: "#242424" }}>
                    Printers per row, within a group
                  </span>
                  <NumberStepper
                    value={appSettings.printersPerRow}
                    min={1}
                    max={8}
                    height={30}
                    onChange={(v) =>
                      setAppSettings((s) => ({ ...s, printersPerRow: v }))
                    }
                  />
                </div>
                <p className="text-xs mt-1" style={{ color: "#8A8886" }}>
                  e.g. a group of 4 printers shown 2-wide displays as a 2×2 block.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium" style={{ color: "#242424" }}>
                    Groups per row, across the board
                  </span>
                  <NumberStepper
                    value={appSettings.groupsPerRow}
                    min={1}
                    max={6}
                    height={30}
                    onChange={(v) =>
                      setAppSettings((s) => ({ ...s, groupsPerRow: v }))
                    }
                  />
                </div>
                <p className="text-xs mt-1" style={{ color: "#8A8886" }}>
                  How many groups sit side by side before wrapping to the next row.
                </p>
              </div>

              <div
                className="rounded-lg p-3 text-xs"
                style={{ background: "#F4F6FD", color: "#5B5FC7" }}
              >
                Current: groups display{" "}
                <strong>{appSettings.printersPerRow}</strong> printer
                {appSettings.printersPerRow !== 1 ? "s" : ""} wide,{" "}
                <strong>{appSettings.groupsPerRow}</strong> group
                {appSettings.groupsPerRow !== 1 ? "s" : ""} across. The board scrolls
                horizontally below{" "}
                {boardMinW(appSettings.printersPerRow, appSettings.groupsPerRow)}px.
              </div>
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

      {/* ---------------- status bar: in-progress printers ---------------- */}
      <div
        className="px-5 py-2 flex items-center gap-2 flex-wrap border-b"
        style={{ background: "white", borderColor: "#E1DFDD" }}
      >
        <span
          className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide"
          style={{ color: "#605E5C" }}
        >
          <Activity size={14} style={{ color: "#0F6CBD" }} />
          In progress
        </span>
        {inProgressPrinters.length === 0 ? (
          <span className="text-xs" style={{ color: "#8A8886" }}>
            No printers have tasks in progress
          </span>
        ) : (
          inProgressPrinters.map((p) => (
            <span
              key={p.id}
              className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
              style={{
                background: `${p.color}1A`,
                color: p.color,
                border: `1px solid ${p.color}40`,
              }}
            >
              <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
              {p.name}
              <span
                className="px-1.5 rounded-full text-white"
                style={{ background: p.color, fontSize: 10 }}
              >
                {p.count}
              </span>
            </span>
          ))
        )}
      </div>

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
        onStartAdd={() => setAddingTaskIn(STAGING)}
        onCancelAdd={() => setAddingTaskIn(null)}
        onAdd={(fields) => addTask(STAGING, fields)}
        onDropTask={(taskId) => moveTask(taskId, STAGING)}
        onDropOnTask={moveTaskRelative}
        onExpandTask={(id) =>
          setExpandedTaskId((cur) => (cur === id ? null : id))
        }
        onContextMenu={openTaskMenu}
        onDragStart={setDraggingTaskId}
        onDragEnd={() => setDraggingTaskId(null)}
      />

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
                  borderLeft: `4px solid ${group.color}`,
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
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ background: group.color }}
                    title="Group color (assigned automatically)"
                  />
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
                      style={{ borderColor: group.color, color: "#242424" }}
                      aria-label="Group name"
                    />
                  ) : (
                    <span className="font-semibold text-sm" style={{ color: "#242424" }}>
                      {group.name}
                    </span>
                  )}
                  {!isEditing && (
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
                        color={group.color}
                        groupName={group.name}
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
                        onPurgeDone={askPurgeDone}
                        onStartAddTask={() => setAddingTaskIn(printer.id)}
                        onCancelAddTask={() => setAddingTaskIn(null)}
                        onAddTask={(fields) => addTask(printer.id, fields)}
                        onExpandTask={(id) =>
                          setExpandedTaskId((cur) => (cur === id ? null : id))
                        }
                        onDropTask={(taskId) => moveTask(taskId, printer.id)}
                        onDropOnTask={moveTaskRelative}
                        onTaskContextMenu={openTaskMenu}
                        onPrinterContextMenu={openPrinterMenu}
                        onDragStart={setDraggingTaskId}
                        onDragEnd={() => setDraggingTaskId(null)}
                      />
                    ))}

                    <button
                      onClick={() => addPrinter(group.id)}
                      className="w-full mt-2 rounded-lg border-2 border-dashed flex items-center justify-center gap-2 py-6 text-sm font-medium hover:bg-white"
                      style={{ borderColor: "#C8C6C4", color: "#605E5C" }}
                    >
                      <Plus size={16} /> Add printer
                    </button>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </main>

      {/* add group — outside the scrolling board so it stays at viewport width */}
      <div className="px-5 pb-5">
        {showNewGroup ? (
          <div
            className="rounded-lg p-3 flex gap-2 items-center"
            style={{ background: "white", border: "1px solid #E1DFDD", maxWidth: 480 }}
          >
            <span
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ background: nextGroupColor(groups) }}
              title="This group's color (assigned automatically)"
            />
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
          </div>
        )}
      </div>

      {/* ---------------- task detail modal (single instance, app level) ----
          Kept out of TaskCard so it survives the card unmounting mid-edit —
          e.g. setting a job Complete moves it to the Completed section. */}
      {expandedTask && (
        <TaskDetailModal
          task={expandedTask}
          inStaging={expandedTask.printerId === STAGING}
          choices={choices}
          onUpdate={updateTask}
          onDelete={deleteTask}
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
          onClose={() => setContextMenu(null)}
          onUpdateTask={updateTask}
          onDeleteTask={deleteTask}
          onMoveTask={moveTask}
          onCopyTask={copyTask}
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
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={onCancel}
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

  const Item = ({ icon, label, onClick, danger, swatch }) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
        onClose();
      }}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-100"
      style={{ color: danger ? "#D13438" : "#242424" }}
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
    /* only Ready printers can take work */
    const destinations = printers.filter(
      (p) => acceptsTasks(p.id) && p.id !== task.printerId
    );
    content = (
      <>
        {task.printerId !== STAGING && (
          <>
            <Header>Set status</Header>
            {STATUSES.map((s) => (
              <Item
                key={s}
                swatch={STATUS_STYLE[s].dot}
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
            ))}
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
        <Divider />
        <Header>Move to</Header>
        {task.printerId !== STAGING && (
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
              swatch={g?.color || "#69797E"}
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
        <Divider />
        <Item
          icon={<Pencil size={14} style={{ color: "#605E5C" }} />}
          label="Edit details"
          onClick={() => onExpandTask(task.id)}
        />
        <Item
          icon={<Copy size={14} style={{ color: "#605E5C" }} />}
          label="Duplicate task"
          onClick={() => onCopyTask(task.id)}
        />
        <Item
          icon={<Trash2 size={14} />}
          label="Delete task"
          danger
          onClick={() => onDeleteTask(task.id)}
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
          label="Delete printer (tasks go to staging)"
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

function StagingArea({
  name,
  onRename,
  tasks,
  choices,
  adding,
  expandedTaskId,
  draggingTaskId,
  onStartAdd,
  onCancelAdd,
  onAdd,
  onDropTask,
  onDropOnTask,
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
  const [limit, setLimit] = useState(STAGING_PAGE);
  const scrollRef = useRef(null);
  const loadingRef = useRef(false);
  const showDrop = dragOver && !!draggingTaskId;

  /* filter → then sort by priority (Urgent first), stable within a tier */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (priorityFilter !== "All" && (t.priority || "Normal") !== priorityFilter)
        return false;
      if (!q) return true;
      return (
        (t.title || "").toLowerCase().includes(q) ||
        (t.sentBy || "").toLowerCase().includes(q) ||
        (t.giveTo || "").toLowerCase().includes(q) ||
        (t.filepath || "").toLowerCase().includes(q)
      );
    });
  }, [tasks, query, priorityFilter]);

  const sorted = useMemo(() => {
    return filtered
      .map((t, i) => [t, i])
      .sort((a, b) => {
        const pa = PRIORITY_RANK[a[0].priority || "Normal"];
        const pb = PRIORITY_RANK[b[0].priority || "Normal"];
        return pa !== pb ? pa - pb : a[1] - b[1]; // stable within tier
      })
      .map(([t]) => t);
  }, [filtered]);

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

  /* re-arm once the new batch has rendered, so one flick of the wheel
     loads one batch rather than firing on every scroll event */
  useEffect(() => {
    loadingRef.current = false;
  }, [limit]);

  const loadMore = () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLimit((l) => l + STAGING_PAGE);
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || hidden <= 0) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) loadMore();
  };

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
            <button
              onClick={() => setEditingName(true)}
              className="p-1 rounded hover:bg-gray-200"
              title="Rename staging area"
              aria-label="Rename staging area"
            >
              <Pencil size={12} style={{ color: "#8A8886" }} />
            </button>
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
          <Plus size={14} /> New task
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
                color="#5B5FC7"
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
              No parts match your search.
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
                      color="#5B5FC7"
                      disabled={false}
                      expanded={expandedTaskId === task.id}
                      onExpand={() => onExpandTask(task.id)}
                      onContextMenu={onContextMenu}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                      onDropOnTask={onDropOnTask}
                      inStaging
                      dragging={draggingTaskId === task.id}
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

/* --------------------------- status picker ---------------------------- */

/* The pill states what the printer is; the menu states what each state does,
   because "Reserved" on its own doesn't tell an operator their drag will be
   refused. Positioned fixed so it can't be clipped by the group card. */
function StatusPicker({ status, onSelect }) {
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
      top: Math.min(r.bottom + 4, window.innerHeight - 176),
      left: Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8)),
    });
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={open}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        title={`${status} — ${state.blurb}. Click to change.`}
        className="flex items-center gap-1 font-semibold px-2 py-1 rounded-full flex-shrink-0"
        style={{ fontSize: 10, background: state.bg, color: state.text }}
      >
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: state.color }}
        />
        {status}
        <ChevronDown size={11} />
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
  color,
  groupName,
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
  onPurgeDone,
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
  const [doneOpen, setDoneOpen] = useState(false);

  /* Maintenance dims the card, but never the control that brings it back —
     a CSS filter applies to the whole subtree, so the dimming lives on a
     wrapper the status button sits outside of */
  const dim = inactive ? { opacity: 0.55, filter: "grayscale(0.9)" } : undefined;

  /* running queue = active (non-complete) jobs; completed jobs collapse
     into a separate section at the bottom and leave the active slot count */
  const activeTasks = tasks.filter((t) => t.status !== "Complete");
  const doneTasks = tasks.filter((t) => t.status === "Complete");

  /* queue slots: 2 visible by default; force open if the task being edited
     sits beyond slot 2 (e.g. just auto-expanded after assignment) */
  const expandedIdx = activeTasks.findIndex((t) => t.id === expandedTaskId);
  const queueExpanded = queueOpen || expandedIdx >= 2;
  const visibleTasks = queueExpanded ? activeTasks : activeTasks.slice(0, 2);
  const hiddenCount = Math.max(0, activeTasks.length - 2);
  const showDrop = dragOver && !!draggingTaskId && accepts;

  const emptyLabel = showDrop
    ? "Drop task here"
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
        background: showDrop ? `${stateColor}0D` : "white",
        border: showDrop ? `1px solid ${stateColor}` : "1px solid #E1DFDD",
        borderTop: `4px solid ${stateColor}`,
        boxShadow: showDrop ? `0 0 0 2px ${stateColor}33` : "none",
      }}
      onDragOver={(e) => {
        if (!accepts) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!accepts) return;
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDropTask(id);
        setDragOver(false);
      }}
    >
      {/* ---- printer header (right-click for menu) ---- */}
      <div
        className="px-3 pt-2.5 pb-2 flex items-center gap-2"
        onContextMenu={(e) => onPrinterContextMenu(e, printer.id)}
      >
        <div className="flex-1 min-w-0 flex items-center gap-2" style={dim}>
          {/* color dot inherited from group — not assignable */}
          <span
            className="w-4 h-4 rounded-full border-2 border-white shadow flex-shrink-0"
            style={{ background: color }}
            title={`Color follows group "${groupName}"`}
          />

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
              style={{ borderColor: color }}
              aria-label="Printer name"
            />
          ) : (
            <button
              onClick={() => !inactive && setEditingName(true)}
              className="flex-1 min-w-0 text-left text-sm font-semibold truncate"
              style={{ color: "#242424" }}
              title="Rename printer (or right-click for more)"
            >
              {printer.name}
            </button>
          )}

          <button
            onClick={onToggleSettings}
            className="p-1 rounded hover:bg-gray-100 flex-shrink-0"
            aria-label="Printer settings"
            title="Printer settings"
          >
            <Settings size={15} style={{ color: settingsOpen ? color : "#605E5C" }} />
          </button>
        </div>

        {/* one control, three states — never dimmed, so a printer in
            maintenance can always be brought back */}
        <StatusPicker
          status={printer.status}
          onSelect={(s) => onSetStatus(printer.id, s)}
        />
      </div>

      {/* everything below the header dims with the off state */}
      <div className="flex flex-col flex-1" style={dim}>
        {/* group label */}
        <div
          className="px-3 pb-2 flex items-center gap-1.5 text-xs"
          style={{ color: "#8A8886" }}
        >
          <span
            className="px-1.5 py-0.5 rounded font-medium"
            style={{
              background: `${color}14`,
              color: inactive ? "#8A8886" : color,
            }}
          >
            {groupName}
          </span>
          <span>
            · {tasks.length} task{tasks.length !== 1 && "s"}
          </span>
        </div>

        {/* assigned printer settings — compact, collapsible readout */}
        <div className="px-3 pb-2">
          <button
            onClick={() => setSpecsOpen((v) => !v)}
            className="w-full flex items-center gap-1 text-left"
            aria-expanded={specsOpen}
            title={specsOpen ? "Collapse settings" : "Expand settings"}
          >
            {specsOpen ? (
              <ChevronDown size={11} style={{ color: "#8A8886" }} className="flex-shrink-0" />
            ) : (
              <ChevronRight size={11} style={{ color: "#8A8886" }} className="flex-shrink-0" />
            )}
            <span className="text-xs italic truncate" style={{ color: "#8A8886" }}>
              {PRINTER_FIELDS.map((f) => settings.fields[f.key]).join(" · ")}
            </span>
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
                title="Delete printer (tasks go to staging)"
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
              color={color}
              disabled={inactive}
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
                color: showDrop ? color : "#C8C6C4",
                background: "#FAF9F8",
                borderColor: showDrop ? color : "#E1DFDD",
              }}
            >
              {emptyLabel}
            </div>
          )}

          {/* expand / collapse the rest of the active queue */}
          {hiddenCount > 0 && !queueExpanded && (
            <button
              onClick={() => setQueueOpen(true)}
              className="w-full flex items-center justify-center gap-1 text-xs font-medium py-1.5 rounded hover:bg-gray-50"
              style={{ color: inactive ? "#8A8886" : color }}
            >
              <ChevronDown size={13} /> Show {hiddenCount} more queued
            </button>
          )}
          {queueExpanded && activeTasks.length > 2 && (
            <button
              onClick={() => setQueueOpen(false)}
              className="w-full flex items-center justify-center gap-1 text-xs font-medium py-1.5 rounded hover:bg-gray-50"
              style={{ color: inactive ? "#8A8886" : color }}
            >
              <ChevronUp size={13} /> Show less
            </button>
          )}
        </div>

        {/* ---- completed jobs: collapsed section ---- */}
        {doneTasks.length > 0 && (
          <div className="px-3 pt-1">
            <button
              onClick={() => setDoneOpen((v) => !v)}
              className="w-full flex items-center gap-1.5 text-xs font-medium py-1.5 px-1 rounded hover:bg-gray-50"
              style={{ color: "#498205" }}
              aria-expanded={doneOpen}
            >
              {doneOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <Check size={12} />
              Completed
              <span
                className="ml-1 px-1.5 rounded-full font-semibold"
                style={{ background: "#DFF6DD", color: "#498205", fontSize: 10 }}
              >
                {doneTasks.length}
              </span>
            </button>
            {doneOpen && (
              <div className="space-y-2 pt-1 pb-1 max-h-48 overflow-y-auto">
                {doneTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    color={color}
                    disabled={inactive}
                    expanded={expandedTaskId === task.id}
                    onExpand={() => !inactive && onExpandTask(task.id)}
                    onContextMenu={onTaskContextMenu}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    onDropOnTask={accepts ? onDropOnTask : undefined}
                    dragging={draggingTaskId === task.id}
                  />
                ))}
                <button
                  onClick={() => onPurgeDone(printer.id)}
                  className="w-full flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded border border-dashed hover:bg-red-50"
                  style={{ borderColor: "#F3D6D8", color: "#D13438" }}
                  title="Permanently remove all completed jobs from this printer"
                >
                  <Trash2 size={12} /> Clear history ({doneTasks.length})
                </button>
              </div>
            )}
          </div>
        )}

        {/* ---- add task ---- */}
        <div className="px-3 pb-3 pt-2 mt-auto">
          {addingTask ? (
            <AddTaskForm
              color={color}
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
                color: accepts ? color : "#8A8886",
              }}
              title={
                accepts
                  ? "Add a task to this printer"
                  : "Only a Ready printer can take new work"
              }
            >
              <Plus size={15} /> Add task
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- task card ------------------------------ */

function TaskCard({
  task,
  color,
  disabled,
  expanded,
  onExpand,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDropOnTask,
  inStaging,
  dragging,
}) {
  const eta = formatEta(task.etaDate, task.etaTime);
  const overdue = isOverdue(task);
  const st = STATUS_STYLE[task.status];
  const [overPos, setOverPos] = useState(null); // 'before' | 'after' | null

  const indicatorShadow = !overPos
    ? "none"
    : overPos === "before"
    ? `0 -3px 0 0 ${color}`
    : `0 3px 0 0 ${color}`;

  return (
    <div
      draggable={!disabled && !expanded}
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
      onContextMenu={(e) => !disabled && onContextMenu && onContextMenu(e, task.id)}
      className="rounded-lg border"
      style={{
        borderColor: expanded ? color : "#E1DFDD",
        background: task.status === "Complete" ? "#FAFAF9" : "white",
        opacity: dragging ? 0.4 : 1,
        cursor: disabled ? "default" : "grab",
        boxShadow: indicatorShadow,
      }}
    >
      {/* collapsed row — minimal: name + status + ETA. Detail in modal. */}
      <button
        onClick={onExpand}
        disabled={disabled}
        className="w-full text-left px-2.5 py-2"
        title={disabled ? undefined : "Click for details · drag to move · right-click for menu"}
      >
        {/* line 1: status dot + title + qty + priority flag + status pill */}
        <div className="flex items-center gap-1.5 min-w-0">
          {!inStaging && (
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: st.dot }}
              title={task.status}
            />
          )}
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
          {(task.quantity || 1) > 1 && (
            <span
              className="font-semibold flex-shrink-0"
              style={{ color: "#8A8886", fontSize: 11 }}
              title={`Quantity: ${task.quantity}`}
            >
              ×{task.quantity}
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
          {!inStaging && (
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
          )}
        </div>

        {/* line 2: ETA, compact inline — printers only. Red when past due. */}
        {!inStaging && (
          <div
            className="mt-1 flex items-center gap-1.5"
            style={{ color: overdue ? "#D13438" : "#8A8886", fontSize: 10 }}
          >
            <span className="font-semibold uppercase tracking-wide" style={{ fontSize: 9 }}>
              ETA
            </span>
            <span
              className={`tabular-nums${overdue ? " font-semibold" : ""}`}
              style={{ color: overdue ? "#D13438" : "#605E5C" }}
            >
              {eta ? `${eta.date || "—"}  ${eta.time || ""}`.trim() : "Not set"}
            </span>
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
function TaskDetailModal({ task, inStaging, choices, onUpdate, onDelete, onClose }) {
  const [draft, setDraft] = useState({});
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    setDraft({});
  }, [task.id]);

  const val = (k, fallback = "") =>
    draft[k] !== undefined ? draft[k] : task[k] ?? fallback;
  const edit = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const flush = () => {
    const pending = draftRef.current;
    if (Object.keys(pending).length) {
      onUpdate(task.id, pending);
      setDraft({});
    }
  };

  const commit = (patch) => {
    onUpdate(task.id, { ...draftRef.current, ...patch });
    setDraft({});
  };

  const close = () => {
    flush();
    onClose();
  };

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
  const st = STATUS_STYLE[task.status];
  const priority = val("priority", "Normal");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={close}
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
          {!inStaging && (
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ background: st.dot }}
              title={task.status}
            />
          )}
          <h2
            className="flex-1 min-w-0 text-base font-semibold truncate"
            style={{ color: "#242424" }}
            title={val("title")}
          >
            {val("title") || "Untitled task"}
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

        {/* modal body — scrolls if tall */}
        <div className="px-4 py-3 space-y-3 overflow-y-auto">
          <Field label="Task name">
            <input
              value={val("title")}
              onChange={(e) => edit("title", e.target.value)}
              onBlur={flush}
              className={MODAL_INPUT}
              style={MODAL_STYLE}
              aria-label="Task title"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Sent by">
              <input
                value={val("sentBy")}
                onChange={(e) => edit("sentBy", e.target.value)}
                onBlur={flush}
                placeholder="Requester"
                className={MODAL_INPUT}
                style={MODAL_STYLE}
              />
            </Field>
            <Field label="Give to">
              <input
                value={val("giveTo")}
                onChange={(e) => edit("giveTo", e.target.value)}
                onBlur={flush}
                placeholder="Recipient"
                className={MODAL_INPUT}
                style={MODAL_STYLE}
              />
            </Field>
          </div>

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
              <NumberStepper
                value={val("quantity", 1) || 1}
                min={1}
                max={9999}
                height={38}
                editable
                onBlur={flush}
                onChange={(v, immediate) =>
                  immediate ? commit({ quantity: v }) : edit("quantity", v)
                }
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

          {/* ETA — printers only */}
          {!inStaging && (
            <Field label="ETA">
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="date"
                  value={val("etaDate")}
                  onChange={(e) => commit({ etaDate: e.target.value })}
                  className={MODAL_INPUT}
                  style={MODAL_STYLE}
                  aria-label="ETA date"
                />
                <input
                  type="time"
                  value={val("etaTime")}
                  onChange={(e) => commit({ etaTime: e.target.value })}
                  className={MODAL_INPUT}
                  style={MODAL_STYLE}
                  aria-label="ETA time"
                />
              </div>
            </Field>
          )}

          <div className={inStaging ? "" : "grid grid-cols-2 gap-3"}>
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
                  onChange={(e) => commit({ status: e.target.value })}
                  className={MODAL_SELECT}
                  style={MODAL_STYLE}
                >
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
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
        </div>

        {/* modal footer */}
        <div
          className="flex items-center justify-between px-4 py-3 border-t flex-shrink-0"
          style={{ borderColor: "#EDEBE9" }}
        >
          <button
            onClick={() => onDelete(task.id)}
            className="flex items-center gap-1.5 text-sm font-medium px-2 py-1.5 rounded hover:bg-red-50"
            style={{ color: "#D13438" }}
            title="Delete task"
          >
            <Trash2 size={15} /> Delete
          </button>
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
const MODAL_SELECT =
  "w-full text-sm px-2.5 rounded border bg-white outline-none focus:ring-1";
const MODAL_STYLE = { borderColor: "#C8C6C4", height: 38 };

function Field({ label, children }) {
  return (
    <div className="block">
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

/* ---------------------------- number stepper --------------------------- */

/* One control at two sizes: the shop-layout rows (30px, buttons only) and
   the task quantity field (38px, typeable). onChange's second argument marks
   a discrete press, which callers can treat as "save now". */
function NumberStepper({
  value,
  min = 1,
  max = 99,
  height = 30,
  editable = false,
  onChange,
  onBlur,
}) {
  const step = (v) => onChange(Math.min(max, Math.max(min, v)), true);
  const big = height >= 38;
  return (
    <div
      className={`flex items-center rounded border bg-white overflow-hidden ${
        editable ? "" : "flex-shrink-0"
      }`}
      style={{ borderColor: "#C8C6C4", height }}
    >
      <button
        type="button"
        onClick={() => step(value - 1)}
        disabled={value <= min}
        className={`${big ? "px-3 text-base" : "px-2.5 text-sm"} h-full font-semibold hover:bg-gray-100 disabled:opacity-30`}
        style={{ color: "#605E5C" }}
        aria-label="Decrease"
      >
        −
      </button>
      {editable ? (
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) =>
            onChange(
              Math.min(max, Math.max(min, parseInt(e.target.value, 10) || min)),
              false
            )
          }
          onBlur={onBlur}
          className="w-full min-w-0 text-center text-sm outline-none"
          aria-label="Quantity"
        />
      ) : (
        <span
          className="w-8 text-center text-sm font-medium tabular-nums"
          style={{ color: "#242424" }}
        >
          {value}
        </span>
      )}
      <button
        type="button"
        onClick={() => step(value + 1)}
        disabled={value >= max}
        className={`${big ? "px-3 text-base" : "px-2.5 text-sm"} h-full font-semibold hover:bg-gray-100 disabled:opacity-30`}
        style={{ color: "#605E5C" }}
        aria-label="Increase"
      >
        +
      </button>
    </div>
  );
}

/* --------------------------- add task form ---------------------------- */

function AddTaskForm({ color, choices, showEta, onAdd, onCancel }) {
  const [title, setTitle] = useState("");
  const [etaDate, setEtaDate] = useState("");
  const [etaTime, setEtaTime] = useState("");
  const [sentBy, setSentBy] = useState("");
  const [giveTo, setGiveTo] = useState("");
  const [filepath, setFilepath] = useState("");
  const [sliceStatus, setSliceStatus] = useState("Not Sliced");
  const [printQuality, setPrintQuality] = useState("Medium");
  const [printStrength, setPrintStrength] = useState("Standard");
  const [quantity, setQuantity] = useState(1);
  const [priority, setPriority] = useState("Normal");

  const needsSlicing =
    sliceStatus === "Not Sliced" || sliceStatus === "Needs Nesting";

  const submit = () => {
    if (!title.trim()) return;
    onAdd({
      title: title.trim(),
      etaDate: showEta ? etaDate : "",
      etaTime: showEta ? etaTime : "",
      sentBy: sentBy.trim(),
      giveTo: giveTo.trim(),
      filepath: filepath.trim(),
      sliceStatus,
      quantity,
      priority,
      ...(needsSlicing ? { printQuality, printStrength } : {}),
    });
  };

  return (
    <div
      className="p-2.5 rounded-lg space-y-2"
      style={{ background: "#FAF9F8", border: `1px solid ${color}55` }}
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Task name"
        className="w-full text-sm px-2 py-1.5 rounded border outline-none"
        style={{ borderColor: "#C8C6C4" }}
        aria-label="Task name"
      />
      <div className="flex gap-2">
        <input
          value={sentBy}
          onChange={(e) => setSentBy(e.target.value)}
          placeholder="Sent by"
          className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded border outline-none"
          style={{ borderColor: "#C8C6C4" }}
          aria-label="Sent by"
        />
        <input
          value={giveTo}
          onChange={(e) => setGiveTo(e.target.value)}
          placeholder="Give to"
          className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded border outline-none"
          style={{ borderColor: "#C8C6C4" }}
          aria-label="Give to"
        />
      </div>
      <input
        value={filepath}
        onChange={(e) => setFilepath(e.target.value)}
        placeholder="Filepath, e.g. \\server\prints\part.3mf"
        className="w-full text-xs px-2 py-1.5 rounded border outline-none"
        style={{
          borderColor: "#C8C6C4",
          fontFamily: "Consolas, 'Courier New', monospace",
        }}
        aria-label="Filepath"
      />
      <div className="flex gap-2 items-end">
        <div className="text-xs" style={{ color: "#605E5C" }}>
          <span className="block">Quantity</span>
          <div className="mt-0.5">
            <NumberStepper
              value={quantity}
              min={1}
              max={9999}
              height={38}
              editable
              onChange={(v) => setQuantity(v)}
            />
          </div>
        </div>
        <label className="flex-1 min-w-0 text-xs" style={{ color: "#605E5C" }}>
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
      </div>
      {showEta && (
        <div className="flex gap-2">
          <input
            type="date"
            value={etaDate}
            onChange={(e) => setEtaDate(e.target.value)}
            className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded border outline-none"
            style={{ borderColor: "#C8C6C4" }}
            aria-label="ETA date"
          />
          <input
            type="time"
            value={etaTime}
            onChange={(e) => setEtaTime(e.target.value)}
            className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded border outline-none"
            style={{ borderColor: "#C8C6C4" }}
            aria-label="ETA time"
          />
        </div>
      )}
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
          className="flex-1 text-sm font-medium text-white py-1.5 rounded"
          style={{ background: color }}
        >
          Add task
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

/* ---------------------------------------------------------------------
   Browser mount. Harmless when this file is imported as a component
   module — it only runs if a #root element exists on the page.
   --------------------------------------------------------------------- */
const rootEl = typeof document !== "undefined" && document.getElementById("root");
if (rootEl) createRoot(rootEl).render(<PrintFarmScheduler />);
