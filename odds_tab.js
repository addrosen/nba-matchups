/* Odds tab: what the betting odds SHOULD be, from the model's chance of each line.
   For every player on the slate and every stat (3PM, points, rebounds, assists, PRA, PR, PA, RA)
   the chance he reaches each line, as fair (no-vig) American odds. The night document carries
   odds_params (spread, co-movement and running correction, nba_odds.py) and odds_players
   (name, team, position); projections come from each stat's own board in the same document, so
   a game's odds lock at tip-off with its ratings. The math here matches nba_odds.py, and the
   viewer's injury what-ifs move the odds the same way they move the boards.
   The page's render() calls window.ODDS_TAB.html(ctx) for the Board, Results and Defenses tabs. */
(function () {
  const S = { mk: "pts", pos: "all", sort: { key: "proj", dir: "desc" }, view: "list", pid: null,
    pmk: null, calc: { mk: null, line: "", over: "", under: "" }, cur: null, rmk: "all" };
  const MK = [["fg3m", "3PM"], ["pts", "Points"], ["reb", "Rebounds"], ["ast", "Assists"], ["pra", "PRA"], ["pr", "PR"], ["pa", "PA"], ["ra", "RA"]];
  const SL = { fg3m: "3PM", pts: "PTS", reb: "REB", ast: "AST", pra: "PRA", pr: "PR", pa: "PA", ra: "RA" };
  const LONG = { fg3m: "made threes", pts: "points", reb: "rebounds", ast: "assists", pra: "points + rebounds + assists", pr: "points + rebounds", pa: "points + assists", ra: "rebounds + assists" };
  const ST4 = ["fg3m", "pts", "reb", "ast"];
  const COMBOS = { pra: ["pts", "reb", "ast"], pr: ["pts", "reb"], pa: ["pts", "ast"], ra: ["reb", "ast"] };
  const LADDER = { fg3m: [1, 2, 3, 4, 5], pts: [10, 15, 20, 25, 30, 35, 40], reb: [4, 6, 8, 10, 12, 14], ast: [2, 4, 6, 8, 10, 12],
    pra: [15, 20, 25, 30, 35, 40, 45, 50], pr: [10, 15, 20, 25, 30, 35, 40], pa: [10, 15, 20, 25, 30, 35, 40], ra: [5, 10, 15, 20, 25] };
  const POS = [["all", "All"], ["G", "Guards"], ["F", "Forwards"], ["C", "Centers"]];
  // each stat's matchup grade, as posted on its own board
  const GRADE_T = { "A+": 1, "A": 0.85, "B": 0.68, "C": 0.5, "D": 0.3, "F": 0.08 };
  function gradeOf(n, pid, mk, r3) {
    if (mk === "fg3m") return (r3[pid] && r3[pid].grade) || null;
    if (mk in { pts: 1, reb: 1, ast: 1 }) { const v = (n[mk + "_index"] || {})[pid]; return (v && v[1]) || null; }
    const v = (n.pra_index || {})[pid]; if (!v) return null;
    if (mk === "pra") return v[1] || null;
    const c = (v[5] || {})[mk]; return (c && c[1]) || null;
  }
  try {
    const v = JSON.parse(localStorage.getItem("odds-view") || "{}");
    if (MK.some(([k]) => k === v.mk)) S.mk = v.mk;
    if (["all", "G", "F", "C"].includes(v.pos)) S.pos = v.pos;
  } catch (e) {}
  const save = () => { try { localStorage.setItem("odds-view", JSON.stringify({ mk: S.mk, pos: S.pos })); } catch (e) {} };
  let C = null;
  const active = () => C && C.state.stat === "odds" && ["board", "results", "defense"].includes(C.state.tab);
  const e = (s) => C.esc(s);
  const f1 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toFixed(1));
  const f2 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toFixed(2));
  const pc = (x) => (x == null || isNaN(x) ? "–" : x > 0 && x < 0.005 ? "<1%" : x < 1 && x > 0.995 ? ">99%" : Math.round(x * 100) + "%");
  const pc1 = (x) => (x == null || isNaN(x) ? "–" : (x * 100).toFixed(1) + "%");

  // ---------- the math (same as nba_odds.py) ----------
  function pAtLeast(mu, phi, k) {
    if (k <= 0) return 1;
    if (!mu || mu <= 0) return 0;
    let s = 0;
    if (phi <= 1.001) { let t = Math.exp(-mu); for (let i = 0; i < k; i++) { s += t; t *= mu / (i + 1); } }
    else { const r = mu / (phi - 1), p = 1 / phi; let t = Math.pow(p, r); for (let i = 0; i < k; i++) { s += t; t *= (i + r) / (i + 1) * (1 - p); } }
    return Math.min(1, Math.max(0, 1 - s));
  }
  const pExactly = (mu, phi, k) => Math.max(0, pAtLeast(mu, phi, k) - pAtLeast(mu, phi, k + 1));
  // {market: [mean, phi]} for the single stats he has a projection in, and every combo whose parts he has
  function dist(mu, pos, P) {
    pos = ["G", "F", "C"].includes(pos) ? pos : "F";
    const m = {}, sd = {}, out = {};
    ST4.forEach((s, i) => {
      if (mu[s] == null || isNaN(mu[s])) return;
      const x = Math.max(0, mu[s]) * Math.pow(P.bias[i], P.bias_power);
      const phi = 1 + (P.phi[pos][i] - 1) * P.inflate;
      m[s] = x; sd[s] = Math.sqrt(phi * x); out[s] = [x, phi];
    });
    const cor = {};
    P.pairs.forEach(([a, b], j) => { cor[ST4[a] + ST4[b]] = P.cor[pos][j]; });
    Object.entries(COMBOS).forEach(([c, parts]) => {
      if (parts.some((s) => m[s] == null)) return;
      const mean = parts.reduce((t, s) => t + m[s], 0);
      let v = parts.reduce((t, s) => t + sd[s] * sd[s], 0);
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) v += 2 * cor[parts[i] + parts[j]] * sd[parts[i]] * sd[parts[j]];
      out[c] = [mean, mean > 0 ? Math.max(1, v / mean) : 1];
    });
    return out;
  }
  // fair American odds for a chance p (no bookmaker margin)
  const american = (p) => (p == null || !(p > 0 && p < 1) ? null : p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p);
  const fmtA = (o) => (o == null || !isFinite(o) ? "–" : o >= 0 ? "+" + Math.round(o) : "−" + Math.round(-o));
  const fair = (p) => (p == null ? "–" : p >= 0.99 ? "–" : p <= 0.01 ? "–" : fmtA(american(p)));
  // book odds typed as American (-110, +150, 150) or decimal (1.91) -> chance implied
  function implied(txt) {
    const s = String(txt || "").trim().replace("−", "-");
    if (!s) return null;
    const x = Number(s);
    if (!isFinite(x) || x === 0) return null;
    if (Math.abs(x) >= 100) return x > 0 ? 100 / (x + 100) : -x / (-x + 100);
    if (x > 1 && x < 100 && !s.startsWith("-") && !s.startsWith("+") && s.includes(".")) return 1 / x;   // decimal odds
    return null;
  }
  const payout = (txt) => { const q = implied(txt); return q == null ? null : 100 * (1 - q) / q; };   // profit on a $100 win
  // the half-point line closest to a coin flip (where a book would put its main line)
  function mainLine(m, phi) {
    let best = 1, bd = 9;
    for (let k = 1; k <= Math.ceil(m * 2 + 12); k++) {
      const p = pAtLeast(m, phi, k), d = Math.abs(p - 0.5);
      if (d < bd) { bd = d; best = k; }
      if (p < 0.5 && k > m) break;
    }
    return best;
  }

  // ---------- data ----------
  function css() {
    if (document.getElementById("odds-css")) return;
    const st = document.createElement("style");
    st.id = "odds-css";
    st.textContent = `
.od { display: flex; flex-direction: column; gap: 14px; }
.od-ctl { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; padding: 0 16px 12px; }
.od-ctl .seg { flex-wrap: wrap; }
.od-ctl .lab { font-family: var(--display); font-size: 13px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); margin-right: -6px; }
.od td small { display: block; font-size: 11px; font-weight: 500; opacity: .75; }
.od td.ml { font-weight: 700; white-space: nowrap; }
.od td.ok { color: var(--hi-ink, var(--hi)); font-weight: 700; }
.od td.no { color: var(--ink-3); }
.od td.odd { font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
.od tr.main td { font-weight: 700; box-shadow: inset 0 2px 0 var(--accent), inset 0 -2px 0 var(--accent); }
.od .pos { display: inline-block; min-width: 18px; text-align: center; font-size: 11px; font-weight: 600; color: var(--ink-2); border: 1px solid var(--line-strong); border-radius: 3px; padding: 0 3px; margin-left: 6px; vertical-align: 1px; }
.od .was { display: block; color: var(--ink-3); font-size: 11px; font-weight: 500; }
.od td.pl .link { white-space: nowrap; }
.od .crumbs { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 13px; }
.od .crumbs button { font: inherit; color: #fff; background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgb(255 255 255 / .5); }
.od .tmhero h2 small { display: block; font-size: 17px; font-weight: 500; letter-spacing: .04em; margin-top: 6px; opacity: .85; text-transform: none; }
.od-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 8px; }
.od-tile { background: rgb(255 255 255 / .1); border: 1px solid rgb(255 255 255 / .22); border-radius: 4px; padding: 8px 10px; }
.od-tile b { display: block; font-family: var(--display); font-size: 24px; font-weight: 700; line-height: 1.05; }
.od-tile span { font-size: 12px; opacity: .85; }
.od-tile small { display: block; font-size: 11.5px; opacity: .85; margin-top: 3px; }
.od-calc { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: end; padding: 0 16px 12px; }
.od-calc label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--ink-2); }
.od-calc input { font: inherit; font-size: 15px; width: 104px; padding: 6px 8px; border: 1px solid var(--line-strong); border-radius: 4px; background: var(--surface); color: var(--ink); }
.od-out { padding: 0 16px 14px; }
.od-out table { width: auto; min-width: min(100%, 560px); }
.od-out .good { color: var(--hi-ink, var(--hi)); font-weight: 700; }
.od-out .bad { color: var(--lo-ink, var(--lo)); font-weight: 700; }
.od .note { padding: 0 16px 12px; font-size: 12.5px; color: var(--ink-2); }
`;
    document.head.appendChild(st);
  }
  function tonight(n) {
    const m = {};
    ((n && n.games) || []).forEach((g) => {
      m[g.away] = { opp: g.home, home: false, game: g.game, g };
      m[g.home] = { opp: g.away, home: true, game: g.game, g };
    });
    return m;
  }
  const tName = (t) => ((C.teams || []).find((x) => x.team === t) || {}).name || t;
  // projections posted for one player in a night: {fg3m, pts, reb, ast} (null where he has no board)
  function posted(n, pid, r3) {
    const ix = (k) => { const v = (n[k] || {})[pid]; return v && v[0] != null ? Number(v[0]) : null; };
    const t = r3[pid];
    return { fg3m: t ? Number(t.proj_3pm) : null, pts: ix("pts_index"), reb: ix("reb_index"), ast: ix("ast_index") };
  }
  function nightRows(n, whatIf = true) {
    const P = n && n.odds_params, pl = (n && n.odds_players) || {};
    if (!P) return [];
    const T = tonight(n), r3 = {};
    (n.rows || []).forEach((r) => (r3[String(r.player_id)] = r));
    return Object.entries(pl).map(([pid, v]) => {
      const [name, team, pos] = v, tn = T[team];
      if (!tn) return null;
      const r = { pid, name, team, pos, opp: tn.opp, home: tn.home, game: tn.game, g: tn.g, mu: posted(n, pid, r3), was: null };
      if (ST4.every((s) => r.mu[s] == null)) return null;
      if (whatIf && C.wi) {
        const w = C.wi(n, pid, team);
        if (w === "out") return null;
        if (w && typeof w === "object") {
          const m2 = { ...r.mu }; let ch = false;
          ST4.forEach((s) => { if (w[s] != null && m2[s] != null && Math.abs(w[s] - m2[s]) >= 0.005) { m2[s] = w[s]; ch = true; } });
          if (ch) { r.was = r.mu; r.mu = m2; }
        }
      }
      r.d = dist(r.mu, pos, P);
      if (r.was) r.dw = dist(r.was, pos, P);
      return r;
    }).filter(Boolean);
  }
  const actualOf = (a, mk) => (!a || !a.min ? null : (COMBOS[mk] || [mk]).some((s) => a[s] == null) ? null : (COMBOS[mk] || [mk]).reduce((t, s) => t + a[s], 0));
  const projOf = (r, mk) => (r.d[mk] ? (COMBOS[mk] || [mk]).reduce((t, s) => t + (r.mu[s] || 0), 0) : null);

  // ---------- Board ----------
  function boardHTML() {
    const n = C.night;
    if (!n) return `<p class="notice">No night picked.</p>`;
    if (!n.odds_params) return `<section class="card"><header><h3>Fair odds</h3></header><div class="empty"><p>Odds start with the next board built after this update. Nights posted before then (and games that locked before then) stay without them.</p></div></section>`;
    const mk = S.mk, L = LADDER[mk];
    let rows = nightRows(n).filter((r) => r.d[mk]);
    const sel = C.state.sel || [];
    if (sel.length) rows = rows.filter((r) => sel.includes(r.game));
    if (S.pos !== "all") rows = rows.filter((r) => r.pos === S.pos);
    const graded = n.status === "graded" && n.results;
    const r3 = {}; (n.rows || []).forEach((x) => (r3[String(x.player_id)] = x));
    rows.forEach((r) => {
      r.grade = gradeOf(n, r.pid, mk, r3);
      const [m, phi] = r.d[mk];
      r.proj = projOf(r, mk); r.k = mainLine(m, phi); r.pk = pAtLeast(m, phi, r.k);
      r.lad = L.map((k) => pAtLeast(m, phi, k));
      if (r.dw && r.dw[mk]) r.pkWas = pAtLeast(r.dw[mk][0], r.dw[mk][1], r.k);
      r.act = graded ? actualOf(n.results[r.pid], mk) : null;
    });
    const val = { name: (r) => r.name, proj: (r) => r.proj, line: (r) => r.k, act: (r) => (r.act == null ? -1 : r.act) };
    L.forEach((k, i) => (val["k" + k] = (r) => r.lad[i]));
    val.grade = (r) => (r.grade ? GRADE_T[r.grade] ?? 0 : -1);
    const key = S.sort.key in val ? S.sort.key : "proj", dir = S.sort.dir === "asc" ? 1 : -1, f = val[key];
    rows.sort((a, b) => (key === "grade" ? (!a.grade - !b.grade) || dir * (f(a) - f(b))   // no grade: always last
      : key === "name" ? dir * String(a.name).localeCompare(String(b.name)) : dir * (f(a) - f(b))) || b.proj - a.proj);
    const th = (k, label, cls = "", title = "") => {
      const sa = S.sort.key === k ? ` aria-sort="${S.sort.dir === "asc" ? "ascending" : "descending"}"` : "";
      return `<th class="${cls}"${sa}${title ? ` title="${e(title)}"` : ""}><button type="button" class="sortb" data-odsort="${k}">${label}</button></th>`;
    };
    const dg = mk === "fg3m" ? 2 : 1, fx = (x) => (x == null ? "–" : Number(x).toFixed(dg));
    const body = rows.map((r, i) => {
      const lockd = r.g && C.locked(n, r.g);
      const flag = r.was ? `<span class="flag">What-if ${r.proj >= projOf({ d: r.dw, mu: r.was }, mk) ? "+" : "−"}${Math.abs(r.proj - projOf({ d: r.dw, mu: r.was }, mk)).toFixed(dg)}</span>` : "";
      const lad = r.lad.map((p, j) => {
        const hit = r.act != null ? (r.act >= L[j] ? " ok" : " no") : "";
        return `<td class="tmh odd${j === 0 ? " gs" : ""}${hit}" style="--h:${Math.round(55 * p)}%" title="${e(`${L[j]}+ ${LONG[mk]}: ${pc1(p)} chance, fair odds ${fair(p)}${r.act != null ? (r.act >= L[j] ? " — hit" : " — missed") : ""}`)}">${fair(p)}<small>${pc(p)}</small></td>`;
      }).join("");
      const over = r.pk, under = 1 - r.pk;
      const res = graded ? (r.act == null ? `<td class="gs mut">DNP</td>` : `<td class="gs ${r.act >= r.k ? "ok" : "no"}" title="${e(`${r.act} ${LONG[mk]}: ${r.act >= r.k ? "over" : "under"} ${r.k - 0.5}`)}">${r.act}<small>${r.act >= r.k ? "Over" : "Under"}</small></td>`) : "";
      return `<tr>
        <td class="rk">${i + 1}</td>
        <td class="pl"><button type="button" class="link" data-odplayer="${e(r.pid)}">${e(r.name)}</button><span class="pos">${e(r.pos)}</span>${flag}<small><button type="button" class="tlink" data-team="${e(r.team)}">${e(r.team)}</button> ${r.home ? "vs" : "@"} <button type="button" class="tlink" data-team="${e(r.opp)}">${e(r.opp)}</button>${lockd ? "" : ` · <span class="dim">preview</span>`}</small></td>
        <td class="gs">${fx(r.proj)}${r.was ? `<span class="was">was ${fx(projOf({ d: r.dw, mu: r.was }, mk))}</span>` : ""}</td>
        <td>${r.grade ? `<span class="g" style="background:${C.heat(GRADE_T[r.grade] ?? 0.5)}">${e(r.grade)}</span>` : `<span class="mut">–</span>`}</td>
        <td class="gs ml" title="The half-point line closest to 50/50 — where a book's main line usually sits">${r.k - 0.5}</td>
        <td class="odd" title="${e(`Over ${r.k - 0.5}: ${pc1(over)}`)}">${fair(over)}<small>${pc(over)}${r.pkWas != null ? ` · was ${pc(r.pkWas)}` : ""}</small></td>
        <td class="odd" title="${e(`Under ${r.k - 0.5}: ${pc1(under)}`)}">${fair(under)}<small>${pc(under)}</small></td>
        ${lad}${res}</tr>`;
    }).join("");
    let summary = "";
    if (graded) {
      const xs = rows.filter((r) => r.act != null);
      if (xs.length) {
        const ov = xs.filter((r) => r.act >= r.k).length, exp = xs.reduce((t, r) => t + r.pk, 0);
        const ladN = xs.length * L.length, ladHit = xs.reduce((t, r) => t + L.filter((k) => r.act >= k).length, 0), ladExp = xs.reduce((t, r) => t + r.lad.reduce((a, b) => a + b, 0), 0);
        const tile = (big, small) => `<div class="tile"><b>${big}</b><small>${small}</small></div>`;
        summary = `<section class="card"><header><h3>How the night graded · ${e(SL[mk])}</h3></header><div class="tiles">
          ${tile(`${ov} <span style="font-size:18px;color:var(--ink-3)">/ ${f1(exp)}</span>`, `Overs on the main line vs expected (${xs.length} players who played)`)}
          ${tile(`${ladHit} <span style="font-size:18px;color:var(--ink-3)">/ ${f1(ladExp)}</span>`, `Ladder lines hit vs expected (${ladN} lines)`)}</div></section>`;
      }
    }
    const mkBtns = MK.map(([k, l]) => `<button type="button" data-odmk="${k}" aria-pressed="${S.mk === k}">${l}</button>`).join("");
    const posBtns = POS.map(([k, l]) => `<button type="button" data-odpos="${k}" aria-pressed="${S.pos === k}">${l}</button>`).join("");
    const ladTh = L.map((k, j) => th("k" + k, `${k}+`, j === 0 ? "gs" : "", `Fair odds on ${k} or more ${LONG[mk]} (sorts by chance)`)).join("");
    return `${summary}<section class="card">
      <header><h3>${e(sel.length ? (sel.length === 1 ? sel[0] : `${sel.length} games`) : `Fair odds · ${SL[mk]}`)}</h3><span class="eyebrow">${rows.length} player${rows.length === 1 ? "" : "s"}</span></header>
      <p class="cap">What the odds <b>should</b> be if the model is right: each line's chance turned into fair American odds with no bookmaker margin. A book offering <b>better</b> than the fair price (a bigger plus number, or a minus number closer to even) is a bet the model says is worth more than it costs; worse than fair, and it isn't. <b>O/U</b> is the half-point line closest to 50/50, where a book's main line usually sits; the columns after it are "X or more" (over ${L[1] - 0.5} is the same bet as ${L[1]}+). Chances start from his projection on the ${mk in COMBOS ? "Points, Rebounds and Assists boards (added up, allowing for how the stats rise and fall together)" : SL[mk] === "3PM" ? "3PM board" : `${MK.find(([k]) => k === mk)[1]} board`} and assume he plays. Click a player for every line and to check a book's price.</p>
      <div class="od-ctl"><span class="lab">Stat</span><div class="seg" role="group" aria-label="Stat">${mkBtns}</div><span class="lab">Position</span><div class="seg" role="group" aria-label="Position">${posBtns}</div></div>
      <div class="scroll"><table><thead><tr><th class="mut" style="padding-left:16px;text-align:left">#</th>${th("name", "Player", "pl")}${th("proj", "Proj", "gs", `Projected ${LONG[mk]}`)}${th("grade", "Grade", "", `His matchup grade on the ${SL[mk]} board (sorts A+ first)`)}${th("line", "O/U", "gs", "Main line: the half-point line closest to 50/50")}<th>Over</th><th>Under</th>${ladTh}${graded ? th("act", "Result", "gs", `Actual ${LONG[mk]}`) : ""}</tr></thead>
      <tbody>${body || `<tr><td class="l" colspan="${8 + L.length}" style="padding:14px 16px">No players match this filter.</td></tr>`}</tbody></table></div>
      ${noteHTML(n)}</section>`;
  }
  function noteHTML(n) {
    const P = n.odds_params; if (!P) return "";
    const corr = P.bias.map((x, i) => `${SL[ST4[i]]} ×${f2(Math.pow(x, P.bias_power))}`).join(", ");
    return `<p class="note">How the chances are set: each stat is spread by how much players at his position swing from game to game (${e(P.spread_from || "this season")} box scores), widened ${P.inflate}× for projection error. Running correction for what players have actually done vs projected on graded nights (half applied): ${corr}. Backtested on this season's first 23 graded nights: lines the model put at 10-90% hit within about 1½ points of their predicted rate on average.</p>`;
  }

  // ---------- Player ----------
  function playerHTML() {
    const n = C.night, pid = S.pid;
    const row = n ? nightRows(n).find((r) => r.pid === pid) : null;
    const v0 = n && n.odds_players ? n.odds_players[pid] : null;
    const name = (row && row.name) || (v0 && v0[0]) || "Player", team = (row && row.team) || (v0 && v0[1]) || "", pos = (row && row.pos) || (v0 && v0[2]) || "";
    const [band, stripe] = (C.colors && C.colors[team]) || ["#33413A", "#A9B3AC"];
    const tn = tonight(n)[team];
    const graded = n && n.status === "graded" && n.results, a = graded ? n.results[pid] : null;
    const mks = row ? MK.filter(([k]) => row.d[k]).map(([k]) => k) : [];
    if (!S.pmk || !mks.includes(S.pmk)) S.pmk = mks.includes(S.mk) ? S.mk : mks[0];
    if (!S.calc.mk || !mks.includes(S.calc.mk)) S.calc = { mk: S.pmk, line: "", over: "", under: "" };
    S.cur = row;
    const tile = (lab, big, small) => `<div class="od-tile"><span>${lab}</span><b>${big}</b>${small ? `<small>${small}</small>` : ""}</div>`;
    const tiles = row ? mks.map((k) => {
      const [m, phi] = row.d[k], kk = mainLine(m, phi), p = pAtLeast(m, phi, kk), proj = projOf(row, k);
      return tile(SL[k], `${kk - 0.5}`, `proj ${k === "fg3m" ? f2(proj) : f1(proj)} · O ${fair(p)} / U ${fair(1 - p)}`);
    }) : [tile("Tonight", "Out", "Not in tonight's projections (out, or no board for him)")];
    const hero = `<section class="tmhero" style="--tc:${band};--ts:${stripe}"><span class="tmwm" aria-hidden="true">${e(team)}</span>
      <div class="crumbs"><button type="button" data-odback="1">← Tonight's odds</button></div>
      <div class="tmtop"><h2>${e(name)}<small>${e(tName(team))}${pos ? ` · ${e(pos)}` : ""}${tn ? ` · tonight ${tn.home ? "vs" : "@"} ${e(tn.opp)}` : ""}${row && row.was ? " · with your what-if" : ""}</small></h2></div>
      <div class="od-tiles">${tiles.join("")}</div><p class="tmmeta">Main line (half-point line closest to 50/50) for each stat, with fair odds on the over and under.</p></section>`;
    if (!row) return hero;
    // every half-point line from ~96% down to ~4%
    const k0 = S.pmk, [m, phi] = row.d[k0], main = mainLine(m, phi), act = a ? actualOf(a, k0) : null;
    const lines = [];
    for (let k = 1; k <= Math.ceil(m * 3 + 15); k++) {
      const p = pAtLeast(m, phi, k);
      if (p > 0.96 && k < main) continue;
      if (p < 0.04) break;
      lines.push(k);
    }
    const lrows = lines.map((k) => {
      const p = pAtLeast(m, phi, k), hit = act != null ? (act >= k ? "ok" : "no") : "";
      return `<tr class="${k === main ? "main" : ""}"><td class="gs ml">${k - 0.5}</td><td class="tmh" style="--h:${Math.round(55 * p)}%">${pc1(p)}</td><td class="odd gs">${fair(p)}</td><td class="tmh" style="--h:${Math.round(55 * (1 - p))}%">${pc1(1 - p)}</td><td class="odd gs">${fair(1 - p)}</td><td class="mut">${k}+ · ${pc1(pExactly(m, phi, k - 1))} exactly ${k - 1}</td>${act != null ? `<td class="gs ${hit}">${act >= k ? "Over ✓" : "Under ✓"}</td>` : ""}</tr>`;
    }).join("");
    const mkBtns = mks.map((k) => `<button type="button" data-odpmk="${k}" aria-pressed="${S.pmk === k}">${SL[k]}</button>`).join("");
    const parts = COMBOS[k0] ? ` (${COMBOS[k0].map((s) => `${SL[s]} ${s === "fg3m" ? f2(row.mu[s]) : f1(row.mu[s])}`).join(" + ")})` : "";
    const ladder = `<section class="card"><header><h3>Every line · ${SL[k0]}</h3><span class="eyebrow">projected ${k0 === "fg3m" ? f2(projOf(row, k0)) : f1(projOf(row, k0))}${e(parts)}</span></header>
      <div class="od-ctl"><div class="seg" role="group" aria-label="Stat">${mkBtns}</div></div>
      <p class="cap">Fair odds on each side of every half-point line; the outlined row is the main line. "${main}+" and "over ${main - 0.5}" are the same bet.${act != null ? ` He finished with ${act}.` : ""}</p>
      <div class="scroll"><table><thead><tr><th class="gs">Line</th><th>Over</th><th class="gs">Fair</th><th>Under</th><th class="gs">Fair</th><th class="l">Notes</th>${act != null ? `<th class="gs">Result</th>` : ""}</tr></thead><tbody>${lrows}</tbody></table></div></section>`;
    const cmk = mks.map((k) => `<button type="button" data-odcmk="${k}" aria-pressed="${S.calc.mk === k}">${SL[k]}</button>`).join("");
    const calc = `<section class="card"><header><h3>Check a book's line</h3></header>
      <p class="cap">Type the line and the book's odds (American like −115 or +105, or decimal like 1.87). You get the model's chance, the fair price, and the edge: how far the model's chance is above or below the chance the book's price implies, and what a $100 bet is worth to you on average if the model is right. Whole-number lines can push (stake returned).</p>
      <div class="od-ctl"><span class="lab">Stat</span><div class="seg" role="group" aria-label="Stat">${cmk}</div></div>
      <div class="od-calc">
        <label>Line<input type="text" inputmode="decimal" data-odin="line" value="${e(S.calc.line)}" placeholder="${mainLine(...row.d[S.calc.mk]) - 0.5}"></label>
        <label>Over odds<input type="text" inputmode="decimal" data-odin="over" value="${e(S.calc.over)}" placeholder="-110"></label>
        <label>Under odds<input type="text" inputmode="decimal" data-odin="under" value="${e(S.calc.under)}" placeholder="-110"></label>
      </div><div class="od-out" id="od-out">${calcOut()}</div></section>`;
    return hero + calc + ladder;
  }
  function calcOut() {
    const r = S.cur, c = S.calc;
    if (!r || !c.mk || !r.d[c.mk]) return "";
    const [m, phi] = r.d[c.mk];
    const raw = String(c.line || "").trim(), line = raw === "" ? mainLine(m, phi) - 0.5 : Number(raw.replace(",", "."));
    if (!isFinite(line) || line < 0) return `<p class="note">Type a line like 24.5.</p>`;
    const whole = Math.abs(line - Math.round(line)) < 1e-9;
    const over = whole ? pAtLeast(m, phi, Math.round(line) + 1) : pAtLeast(m, phi, Math.floor(line) + 1);
    const push = whole ? pExactly(m, phi, Math.round(line)) : 0, under = Math.max(0, 1 - over - push);
    const fOver = over + under > 0 ? over / (over + under) : null;         // fair price ignores pushes (stake back)
    const qo = implied(c.over), qu = implied(c.under);
    const vig = qo != null && qu != null ? qo + qu - 1 : null;
    const side = (lab, p, f, txt, q, qOther) => {
      const pay = payout(txt);
      const ev = pay != null ? p * pay - (lab === "Over" ? under : over) * 100 : null;
      const nv = q != null && qOther != null ? q / (q + qOther) : null;
      const edge = q != null ? f - q : null;
      const cls = (x) => (x == null ? "" : x > 0 ? "good" : "bad");
      return `<tr><td class="l"><b>${lab} ${line}</b></td><td class="gs">${pc1(p)}${push ? `<small>${pc1(f)} without pushes</small>` : ""}</td><td class="odd gs">${fair(f)}</td>
        <td class="gs">${txt ? `${e(txt)}<small>${pc1(q)} implied${nv != null ? ` · ${pc1(nv)} no-vig` : ""}</small>` : `<span class="mut">–</span>`}</td>
        <td class="gs ${cls(edge)}">${edge == null ? "–" : (edge >= 0 ? "+" : "−") + Math.abs(edge * 100).toFixed(1) + " pts"}</td>
        <td class="gs ${cls(ev)}">${ev == null ? "–" : (ev >= 0 ? "+$" : "−$") + Math.abs(ev).toFixed(2)}</td></tr>`;
    };
    return `<div class="scroll"><table><thead><tr><th class="l">Bet</th><th class="gs">Model chance</th><th class="gs">Fair odds</th><th class="gs">Book</th><th class="gs" title="Model chance minus the chance the book's price implies">Edge</th><th class="gs" title="Average profit per $100 staked if the model is right">EV / $100</th></tr></thead>
      <tbody>${side("Over", over, fOver, c.over, qo, qu)}${side("Under", under, fOver == null ? null : 1 - fOver, c.under, qu, qo)}</tbody></table></div>
      <p class="note">${push ? `Push (exactly ${Math.round(line)}): ${pc1(push)}. ` : ""}${vig != null ? `The book's margin on this pair: ${(vig * 100).toFixed(1)}%. ` : ""}Positive edge and EV mean the price is better than fair by the model; the model can be wrong (injury news, minutes), so small edges are thin.</p>`;
  }

  // ---------- Results: how the odds have held up ----------
  function resultsHTML() {
    const nights = (C.state.nights || []).filter((n) => n.odds_params && n.status === "graded" && n.results);
    const mkBtns = [["all", "All stats"]].concat(MK).map(([k, l]) => `<button type="button" data-odrmk="${k}" aria-pressed="${S.rmk === k}">${l}</button>`).join("");
    if (!nights.length) return `<section class="card"><header><h3>How the odds have held up</h3></header><div class="empty"><p>No graded nights with odds yet. Every night from now on gets graded here: across all the lines the board priced, how often lines the model called 30% (or 60%, or 80%) actually hit. Before this tab existed the same method was backtested on this season's first 23 graded nights: lines it put at 10-90% hit within about 1½ points of their predicted rate on average.</p></div></section>`;
    const bands = [[0, 0.1], [0.1, 0.25], [0.25, 0.4], [0.4, 0.6], [0.6, 0.75], [0.75, 0.9], [0.9, 1.001]];
    const mks = S.rmk === "all" ? MK.map(([k]) => k) : [S.rmk];
    const acc = bands.map(() => ({ n: 0, p: 0, h: 0 })), ml = { n: 0, p: 0, h: 0 };
    let players = 0;
    nights.forEach((n) => {
      nightRows(n, false).forEach((r) => {
        const a = n.results[r.pid]; if (!a || !a.min) return;
        players++;
        mks.forEach((mk) => {
          if (!r.d[mk]) return;
          const act = actualOf(a, mk); if (act == null) return;
          const [m, phi] = r.d[mk], kk = mainLine(m, phi), pm = pAtLeast(m, phi, kk);
          ml.n++; ml.p += pm; ml.h += act >= kk ? 1 : 0;
          LADDER[mk].concat([kk]).forEach((k) => {
            const p = pAtLeast(m, phi, k), b = bands.findIndex(([lo, hi]) => p >= lo && p < hi);
            if (b < 0) return;
            acc[b].n++; acc[b].p += p; acc[b].h += act >= k ? 1 : 0;
          });
        });
      });
    });
    const brow = acc.map((x, i) => {
      if (!x.n) return "";
      const pr = x.p / x.n, ac = x.h / x.n, d = ac - pr;
      return `<tr><td class="l">${Math.round(bands[i][0] * 100)}-${Math.min(100, Math.round(bands[i][1] * 100))}%</td><td class="gs">${x.n.toLocaleString()}</td><td class="gs">${pc1(pr)}</td><td class="gs"><b>${pc1(ac)}</b></td><td class="gs ${Math.abs(d) <= 0.03 ? "ok" : "no"}">${(d >= 0 ? "+" : "−") + Math.abs(d * 100).toFixed(1)}</td></tr>`;
    }).join("");
    return `<section class="card"><header><h3>How the odds have held up</h3><span class="eyebrow">${nights.length} graded night${nights.length === 1 ? "" : "s"} · ${players} player-games</span></header>
      <p class="cap">Every line the board priced (each stat's ladder plus the main line), grouped by the chance the model gave it. If the odds are right, each group's hit rate matches its predicted chance. The <b>gap</b> is actual minus predicted, in percentage points; within 3 is shaded as on target. Players who didn't play are left out (books void those bets).</p>
      <div class="od-ctl"><div class="seg" role="group" aria-label="Stat">${mkBtns}</div></div>
      <div class="scroll"><table><thead><tr><th class="l">Model chance</th><th class="gs">Lines</th><th class="gs">Predicted</th><th class="gs">Hit</th><th class="gs">Gap</th></tr></thead><tbody>${brow}</tbody></table></div>
      ${ml.n ? `<p class="note">Main lines: overs hit ${ml.h} of ${ml.n} (${pc1(ml.h / ml.n)}), model expected ${f1(ml.p)} (${pc1(ml.p / ml.n)}).</p>` : ""}</section>`;
  }

  function html(ctx) {
    C = ctx; css();
    const tab = C.state.tab;
    if (tab === "results") return `<div class="od">${resultsHTML()}</div>`;
    if (tab === "defense") return `<div class="od"><section class="card"><header><h3>Odds</h3></header><div class="empty"><p>The Odds tab has no Defenses view: every matchup is already inside the projections the odds come from (see each stat's own Defenses tab). <button type="button" class="link" data-tab="board">Tonight's odds →</button></p></div></section></div>`;
    if (S.view === "player" && S.pid) return `<div class="od">${playerHTML()}</div>`;
    return `<div class="od">${C.banner || ""}${boardHTML()}</div>`;
  }

  const top = () => { try { document.getElementById("view").scrollIntoView({ block: "start" }); } catch (err) {} };
  document.addEventListener("click", (ev) => {
    if (!active()) return;
    const t = ev.target.closest("button");
    if (!t) return;
    const d = t.dataset;
    if (d.odsort) {
      const k = d.odsort;
      S.sort = S.sort.key === k ? { key: k, dir: S.sort.dir === "desc" ? "asc" : "desc" } : { key: k, dir: k === "name" ? "asc" : "desc" };
      C.render(); return;
    }
    if (d.odmk) { S.mk = d.odmk; if (!(S.sort.key in { name: 1, proj: 1, grade: 1, line: 1, act: 1 })) S.sort = { key: "proj", dir: "desc" }; save(); C.render(); return; }
    if (d.odpos) { S.pos = d.odpos; save(); C.render(); return; }
    if (d.odplayer) { S.pid = String(d.odplayer); S.view = "player"; S.pmk = null; S.calc = { mk: null, line: "", over: "", under: "" }; C.render(); top(); return; }
    if (d.odback) { S.view = "list"; C.render(); top(); return; }
    if (d.odpmk) { S.pmk = d.odpmk; C.render(); return; }
    if (d.odcmk) { S.calc = { mk: d.odcmk, line: "", over: "", under: "" }; C.render(); return; }
    if (d.odrmk) { S.rmk = d.odrmk; C.render(); return; }
  });
  // typing in the line checker updates only its result, so the cursor stays put
  document.addEventListener("input", (ev) => {
    if (!active()) return;
    const t = ev.target; if (!t || !t.dataset || !t.dataset.odin) return;
    S.calc[t.dataset.odin] = t.value;
    const o = document.getElementById("od-out"); if (o) o.innerHTML = calcOut();
  });

  window.ODDS_TAB = { html, dist, pAtLeast, american, mainLine };
})();
