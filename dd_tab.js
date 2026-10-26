/* Double Double tab: the chance each player gets 10+ in two of points, rebounds, assists.
   Tonight's chances come from the night document (dd_index, written by run_board.py with
   nba_dd.py), so they lock at tip-off and get graded like every other board. Season history
   and the double-doubles each defense gives up come from data/dd/all.js (nba_dd.py build).
   The page's render() calls window.DD_TAB.html(ctx) for the Board, Results and Defenses tabs.
   Everything else (state, clicks, styles, the math for injury what-ifs) lives in this file. */
(function () {
  const S = { pos: "all", min: 0, sort: { key: "dd", dir: "desc" }, dcol: "all", ddir: "desc", only: false,
    bview: "list", dview: "rank", pid: null, team: null, from: "board", doc: undefined };
  try {
    const v = JSON.parse(localStorage.getItem("dd-view") || "{}");
    if (["all", "G", "F", "C"].includes(v.pos)) S.pos = v.pos;
    if ([0, 0.2, 0.4].includes(v.min)) S.min = v.min;
    if (v.only) S.only = true;
  } catch (e) {}
  const save = () => { try { localStorage.setItem("dd-view", JSON.stringify({ pos: S.pos, min: S.min, only: S.only })); } catch (e) {} };
  let C = null;
  const active = () => C && C.state.stat === "dd" && ["board", "results", "defense"].includes(C.state.tab);
  const e = (s) => C.esc(s);

  const POS = [["all", "All"], ["G", "Guards"], ["F", "Forwards"], ["C", "Centers"]];
  const POSN = { G: "guards", F: "forwards", C: "centers" };
  const ST = ["pts", "reb", "ast"], SL = { pts: "PTS", reb: "REB", ast: "AST" };
  const PAIRS = [["pr", "PTS + REB"], ["pa", "PTS + AST"], ["ra", "REB + AST"]];
  const f1 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toFixed(1));
  const f2 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toFixed(2));
  const pc = (x) => (x == null || isNaN(x) ? "–" : x < 0.005 && x > 0 ? "<1%" : Math.round(x * 100) + "%");
  const pc1 = (x) => (x == null || isNaN(x) ? "–" : (x * 100).toFixed(1) + "%");
  const ord = (n) => (n == null ? "–" : n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"));
  const md = (iso) => { const [, m, d] = iso.split("-").map(Number); return `${m}/${d}`; };
  const rankT = (r, n) => (r == null || !n ? 0.5 : 1 - (r - 1) / Math.max(1, n - 1));

  // ---------- the math (same as nba_dd.py, line for line) ----------
  const GRID = [], WTS = [];
  (function () { let t = 0; for (let i = 0; i < 201; i++) { const x = -5 + 0.05 * i, w = Math.exp(-x * x / 2); GRID.push(x); WTS.push(w); t += w; } for (let i = 0; i < 201; i++) WTS[i] /= t; })();
  function erfc(x) {
    const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (
      -0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }
  const ncdf = (x) => 0.5 * erfc(-x / Math.SQRT2);
  function ninv(p) {
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    p = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
    if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - 0.02425) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  function pLine(mu, phi, k) {
    if (!mu || mu <= 0) return 0;
    let s = 0;
    if (phi <= 1.001) { let t = Math.exp(-mu); for (let i = 0; i < k; i++) { s += t; t *= mu / (i + 1); } }
    else { const r = mu / (phi - 1), p = 1 / phi; let t = Math.pow(p, r); for (let i = 0; i < k; i++) { s += t; t *= (i + r) / (i + 1) * (1 - p); } }
    return Math.min(1, Math.max(0, 1 - s));
  }
  function chances(mu, phi, lam, k) {
    const q = mu.map((m, i) => pLine(m, phi[i], k));
    const z = q.map((x) => (x <= 1e-9 || x >= 1 - 1e-9 ? null : ninv(1 - x)));
    const s = lam.map((l) => Math.sqrt(1 - l * l));
    let dd = 0, td = 0, pr = 0, pa = 0, ra = 0;
    for (let j = 0; j < GRID.length; j++) {
      const g = GRID[j], w = WTS[j];
      const [a, b, d] = [0, 1, 2].map((i) => (q[i] <= 1e-9 ? 0 : q[i] >= 1 - 1e-9 ? 1 : 1 - ncdf((z[i] - lam[i] * g) / s[i])));
      dd += w * (a * b + a * d + b * d - 2 * a * b * d); td += w * a * b * d; pr += w * a * b; pa += w * a * d; ra += w * b * d;
    }
    return { dd, td, q, pair: { pr, pa, ra } };
  }
  function playerChances(mu, pos, P) {
    pos = ["G", "F", "C"].includes(pos) ? pos : "F";
    const m = mu.map((x, i) => (x || 0) * P.bias[i]);
    const f = P.phi[pos].map((x) => 1 + (x - 1) * P.inflate);
    return chances(m, f, P.lam[pos], P.line || 10);
  }

  // ---------- data ----------
  function css() {
    if (document.getElementById("dd-css")) return;
    const st = document.createElement("style");
    st.id = "dd-css";
    st.textContent = `
.dd { display: flex; flex-direction: column; gap: 14px; }
.dd-ctl { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; padding: 0 16px 12px; }
.dd-ctl .lab { font-family: var(--display); font-size: 13px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); margin-right: -6px; }
.dd td small, .dd td.h small { display: block; font-size: 11px; font-weight: 500; opacity: .75; }
.dd td.tot { font-weight: 700; }
.dd td.ten { font-weight: 700; background: color-mix(in srgb, var(--hi) 38%, var(--surface)); color: var(--ink); }
.dd td.ok { color: var(--hi-ink, var(--hi)); font-weight: 700; }
.dd td.no { color: var(--ink-3); }
.dd .pos { display: inline-block; min-width: 18px; text-align: center; font-size: 11px; font-weight: 600; color: var(--ink-2); border: 1px solid var(--line-strong); border-radius: 3px; padding: 0 3px; margin-left: 6px; vertical-align: 1px; }
.dd .dots { white-space: nowrap; letter-spacing: 0; }
.dd .dots i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid var(--line-strong); margin-right: 2px; vertical-align: 0; }
.dd .dots i.y { background: var(--accent); border-color: var(--accent); }
.dd .dots i.n { border-color: var(--accent); }
.dd .dots i.t { background: var(--ink); border-color: var(--ink); }
.dd td.pl .link { white-space: nowrap; }
.dd .was { display: block; color: var(--ink-3); font-size: 11px; font-weight: 500; }
.dd .crumbs { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 13px; }
.dd .crumbs button { font: inherit; color: #fff; background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgb(255 255 255 / .5); }
.dd .tmhero h2 small { display: block; font-size: 17px; font-weight: 500; letter-spacing: .04em; margin-top: 6px; opacity: .85; text-transform: none; }
.dd-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 8px; }
.dd-tile { background: rgb(255 255 255 / .1); border: 1px solid rgb(255 255 255 / .22); border-radius: 4px; padding: 8px 10px; }
.dd-tile.big { background: rgb(255 255 255 / .18); border-color: rgb(255 255 255 / .4); }
.dd-tile b { display: block; font-family: var(--display); font-size: 28px; font-weight: 700; line-height: 1; }
.dd-tile span { font-size: 12px; opacity: .85; }
.dd-tile small { display: block; font-size: 11.5px; opacity: .8; margin-top: 3px; }
.dd tr.avg td { border-top: 2px solid var(--line-strong); font-weight: 600; }
.dd .key { display: flex; flex-wrap: wrap; gap: 4px 14px; padding: 0 16px 10px; font-size: 12px; color: var(--ink-2); }
`;
    document.head.appendChild(st);
  }
  function ensure() {
    if (S.doc !== undefined || !C.state.db) return;
    S.doc = null;
    C.state.db.doc("dd/all").get().then((s) => { S.doc = s.exists ? s.data() : false; }, () => { S.doc = false; })
      .then(() => { if (active()) C.render(); });
  }
  const tName = (t) => ((C.teams || []).find((x) => x.team === t) || {}).name || t;
  function tonight(n) {
    const m = {};
    ((n && n.games) || []).forEach((g) => {
      m[g.away] = { opp: g.home, home: false, tip: g.tip, game: g.game, g };
      m[g.home] = { opp: g.away, home: true, tip: g.tip, game: g.game, g };
    });
    return m;
  }
  const ent = (pid, v) => ({ pid: String(pid), dd: v[0], td: v[1], opp: v[2], home: v[3], pos: v[4], mu: v[5], q: v[6], pair: v[7], team: v[8], name: v[9] });

  // defenses: double-doubles allowed per game, rank 1 = gives up the most
  function dranks(D) {
    const out = {};
    ["all", "G", "F", "C"].forEach((k) => {
      const xs = D.teams.filter((t) => t.dd[k] != null).slice().sort((a, b) => b.dd[k] - a.dd[k]);
      out[k] = { n: xs.length }; xs.forEach((t, i) => (out[k][t.team] = i + 1));
    });
    return out;
  }
  const isDD = (a) => a && ST.filter((s) => (a[s] || 0) >= 10).length >= 2;
  const isTD = (a) => a && ST.every((s) => (a[s] || 0) >= 10);
  // tonight's rows for a night, with the viewer's injury what-if applied
  function nightRows(n) {
    const idx = (n && n.dd_index) || {};
    const T = tonight(n), P = n && n.dd_params;
    return Object.entries(idx).map(([pid, v]) => {
      const r = ent(pid, v), tn = T[r.team];
      r.game = tn ? tn.game : null; r.g = tn ? tn.g : null;
      if (!P || !C.wi) return r;
      const w = C.wi(n, pid, r.team);
      if (w === "out") { r.out = true; return r; }
      if (w && Array.isArray(w)) {
        const x = playerChances(w, r.pos, P);
        if (Math.abs(x.dd - r.dd) >= 0.005 || Math.abs(x.td - r.td) >= 0.002) {
          r.was = r.dd; r.dd = x.dd; r.td = x.td; r.q = x.q; r.pair = x.pair; r.wmu = w;
        }
      }
      return r;
    }).filter((r) => !r.out);
  }
  const best = (r) => PAIRS.map(([k, l]) => ({ k, l, p: (r.pair || {})[k] || 0 })).sort((a, b) => b.p - a.p)[0];
  const dots = (l10) => `<span class="dots" aria-hidden="true">${l10.slice().reverse().map((g) => {
    const [, , , , , p, rb, a] = g, n10 = [p, rb, a].filter((x) => x >= 10).length, sec = [p, rb, a].sort((x, y) => y - x)[1];
    return `<i class="${n10 === 3 ? "t" : n10 === 2 ? "y" : n10 === 1 && sec >= 8 ? "n" : ""}"></i>`;
  }).join("")}</span>`;
  const l10dd = (l10) => l10.filter((g) => [g[5], g[6], g[7]].filter((x) => x >= 10).length >= 2).length;

  // ---------- Board ----------
  function boardHTML(D) {
    const n = C.night;
    if (!n) return `<p class="notice">No night picked.</p>`;
    if (!n.dd_index) return `<section class="card"><header><h3>Double-doubles</h3></header><div class="empty"><p>Double-double chances start with the next board built after this update. Nights posted before then (and games that locked before then) stay without them; the Defenses tab already has this season's history.</p></div></section>`;
    let rows = nightRows(n);
    const sel = C.state.sel || [];
    if (sel.length) rows = rows.filter((r) => sel.includes(r.game));
    if (S.pos !== "all") rows = rows.filter((r) => r.pos === S.pos);
    if (S.min) rows = rows.filter((r) => r.dd >= S.min);
    const R = D ? dranks(D) : null, tm = {}; (D ? D.teams : []).forEach((t) => (tm[t.team] = t));
    const graded = n.status === "graded" && n.results;
    const actual = (r) => (graded ? n.results[r.pid] || null : null);
    const hist = (r) => (D && D.players[r.pid]) || null;
    const val = {
      dd: (r) => r.dd, td: (r) => r.td, name: (r) => r.name,
      pts: (r) => r.q[0], reb: (r) => r.q[1], ast: (r) => r.q[2],
      season: (r) => { const h = hist(r); return h && h.gp ? h.dd / h.gp : -1; },
      l10: (r) => { const h = hist(r); return h ? l10dd(h.l10) + h.l10.length / 1000 : -1; },
      opp: (r) => { const t = tm[r.opp]; return t ? t.dd[r.pos] ?? t.dd.all : -1; },
      actual: (r) => { const a = actual(r); return !a || !a.min ? -1 : (isTD(a) ? 3 : isDD(a) ? 2 : 0) + ST.reduce((s, k) => s + a[k], 0) / 1000; },
    };
    const k = S.sort.key, dir = S.sort.dir === "asc" ? 1 : -1, f = val[k] || val.dd;
    rows.sort((a, b) => (k === "name" ? dir * String(a.name).localeCompare(String(b.name)) : dir * (f(a) - f(b))) || b.dd - a.dd);
    const mx = Math.max(0.01, ...rows.map((r) => r.dd));
    const th = (key, label, cls = "", title = "") => {
      const sa = S.sort.key === key ? ` aria-sort="${S.sort.dir === "asc" ? "ascending" : "descending"}"` : "";
      return `<th class="${cls}"${sa}${title ? ` title="${e(title)}"` : ""}><button type="button" class="sortb" data-ddsort="${key}">${label}</button></th>`;
    };
    const statCell = (r, i, gs) => {
      const s = ST[i], mu = r.wmu ? r.wmu[i] : r.mu[i], q = r.q[i];
      if (!mu) return `<td class="mut${gs ? " gs" : ""}">–</td>`;
      return `<td class="tmh${gs ? " gs" : ""}" style="--h:${Math.round(55 * q)}%" title="${e(`${SL[s]}: projected ${f1(mu)}, ${pc1(q)} chance of 10+`)}">${f1(mu)}<small>${pc(q)} 10+</small></td>`;
    };
    const body = rows.map((r, i) => {
      const h = hist(r), a = actual(r), b = best(r), t = tm[r.opp];
      const rk = R && t ? (R[r.pos] && R[r.pos][r.opp]) : null, rn = R && R[r.pos] ? R[r.pos].n : 30;
      const oppV = t ? (t.dd[r.pos] ?? t.dd.all) : null;
      const lockd = r.g && C.locked(n, r.g);
      const flag = r.was != null ? `<span class="flag">What-if ${r.dd >= r.was ? "+" : "−"}${Math.abs(Math.round((r.dd - r.was) * 100))}%</span>` : "";
      let act = "";
      if (graded) {
        act = !a || !a.min ? `<td class="gs mut">DNP</td>`
          : `<td class="gs ${isDD(a) ? "ok" : "no"}" title="${e(`${a.pts} PTS, ${a.reb} REB, ${a.ast} AST in ${Math.round(a.min)} min`)}">${isTD(a) ? "TD ✓" : isDD(a) ? "DD ✓" : "✗"}<small>${a.pts}-${a.reb}-${a.ast}</small></td>`;
      }
      return `<tr>
        <td class="rk">${i + 1}</td>
        <td class="pl"><button type="button" class="link" data-ddplayer="${e(r.pid)}" data-ddfrom="board">${e(r.name)}</button><span class="pos">${e(r.pos)}</span>${flag}<small><button type="button" class="tlink" data-team="${e(r.team)}">${e(r.team)}</button> ${r.home ? "vs" : "@"} <button type="button" class="tlink" data-team="${e(r.opp)}">${e(r.opp)}</button>${lockd ? "" : ` · <span class="dim">preview</span>`}</small></td>
        <td class="gs share" style="--w:${Math.round((r.dd / mx) * 100)}"><b>${pc(r.dd)}</b>${r.was != null ? `<span class="was">was ${pc(r.was)}</span>` : ""}</td>
        <td class="l">${b && b.p >= 0.005 ? `${b.l} <span class="dim">${pc(b.p)}</span>` : `<span class="mut">–</span>`}</td>
        <td class="mut">${pc(r.td)}</td>
        ${statCell(r, 0, true)}${statCell(r, 1)}${statCell(r, 2)}
        <td class="gs">${h ? `${h.dd}<span class="dim">/${h.gp}</span><small>${pc(h.gp ? h.dd / h.gp : null)}</small>` : `<span class="mut">–</span>`}</td>
        <td>${h && h.l10.length ? `${dots(h.l10)}<small>${l10dd(h.l10)} of ${h.l10.length}</small>` : `<span class="mut">–</span>`}</td>
        <td class="h" style="background:${rk ? C.heat(rankT(rk, rn)) : "transparent"}" title="${e(`${tName(r.opp)} gives up ${f2(oppV)} double-doubles a game to ${r.pos ? POSN[r.pos] : "opponents"}${rk ? ` (${ord(rk)} most)` : ""}`)}">${f2(oppV)}<small>${rk ? ord(rk) : ""}</small></td>
        ${act}</tr>`;
    }).join("");
    let summary = "";
    if (graded) {
      const xs = nightRows(n).map((r) => ({ r, a: actual(r) })).filter((x) => x.a && x.a.min);
      const hit = xs.filter((x) => isDD(x.a)).length, exp = xs.reduce((s, x) => s + x.r.dd, 0);
      const top = xs.filter((x) => x.r.dd >= 0.5), topHit = top.filter((x) => isDD(x.a)).length;
      const tile = (big, small) => `<div class="tile"><b>${big}</b><small>${small}</small></div>`;
      if (xs.length) summary = `<section class="card"><header><h3>How the night graded</h3></header><div class="tiles">
        ${tile(`${hit} <span style="font-size:18px;color:var(--ink-3)">/ ${f1(exp)}</span>`, "Double-doubles vs expected (players who played)")}
        ${top.length ? tile(`${topHit} of ${top.length}`, "50%+ chances that got one") : ""}
        ${tile(xs.filter((x) => isTD(x.a)).length, `Triple-doubles (${f1(xs.reduce((s, x) => s + x.r.td, 0))} expected)`)}</div></section>`;
    }
    const posBtns = POS.map(([k2, l]) => `<button type="button" data-ddpos="${k2}" aria-pressed="${S.pos === k2}">${l}</button>`).join("");
    const minBtns = [[0, "Everyone"], [0.2, "20%+"], [0.4, "40%+"]].map(([v, l]) => `<button type="button" data-ddmin="${v}" aria-pressed="${S.min === v}">${l}</button>`).join("");
    const P = n.dd_params;
    const corr = P && P.bias ? ` Running correction this season: projections × ${P.bias.map((x, i) => `${SL[ST[i]]} ${f2(x)}`).join(", ")} (what players have actually done vs the boards' projections on graded nights).` : "";
    return `${summary}<section class="card">
      <header><h3>${e(sel.length ? (sel.length === 1 ? sel[0] : `${sel.length} games`) : "Double-double chances tonight")}</h3><span class="eyebrow">${rows.length} player${rows.length === 1 ? "" : "s"}</span></header>
      <p class="cap">The chance each player gets 10+ in two of points, rebounds and assists. It starts from his projections on the Points, Rebounds and Assists boards (matchup, pace, minutes and injuries already in them), spreads each one by how much players at his position swing from game to game, and ties the three together, since a big night in minutes lifts all of them. <b>Likeliest</b> is the pair most likely to both reach 10. Under each projection: his chance of 10+ in that stat. <b>Season</b> and <b>Last 10</b> are double-doubles he's actually had (filled dot = DD, dark = triple-double, ring = one 10+ and another at 8 or 9; oldest on the left). <b>Opp allows</b> is double-doubles per game the opponent gives up to his position, ranked (1st = most).${corr} Chances lock at tip and get graded like every board. Tap a player for his games.${n.note ? " " + e(n.note) : ""}</p>
      <div class="dd-ctl"><span class="lab">Position</span><div class="seg" role="group" aria-label="Position">${posBtns}</div><span class="lab">Show</span><div class="seg" role="group" aria-label="Minimum chance">${minBtns}</div></div>
      <div class="scroll"><table><thead><tr><th class="mut" style="padding-left:16px;text-align:left">#</th>${th("name", "Player", "pl")}${th("dd", "DD", "gs", "Chance of a double-double tonight")}<th class="l" title="The pair of stats most likely to both reach 10">Likeliest</th>${th("td", "TD", "", "Chance of a triple-double")}
        ${th("pts", "PTS", "gs", "Projected points (sorts by chance of 10+)")}${th("reb", "REB", "", "Projected rebounds (sorts by chance of 10+)")}${th("ast", "AST", "", "Projected assists (sorts by chance of 10+)")}
        ${th("season", "Season", "gs", "Double-doubles / games this season")}${th("l10", "Last 10", "", "Double-doubles in his last 10 games")}${th("opp", "Opp allows", "", "Double-doubles per game the opponent gives up to his position")}${graded ? th("actual", "Result", "gs", "PTS-REB-AST in the game") : ""}</tr></thead>
      <tbody>${body || `<tr><td class="l" colspan="13" style="padding:14px 16px">No players match this filter.</td></tr>`}</tbody></table></div></section>`;
  }

  // ---------- Player ----------
  function playerHTML(D) {
    const pid = S.pid, n = C.night, idx = n && n.dd_index, h = D && D.players[pid];
    const row = idx && idx[pid] ? nightRows(n).find((r) => r.pid === pid) : null;
    const v0 = idx && idx[pid] ? ent(pid, idx[pid]) : null;
    const name = (h && h.name) || (v0 && v0.name) || "Player";
    const team = (h && h.team) || (v0 && v0.team) || "";
    const pos = (h && h.pos) || (v0 && v0.pos) || "";
    const [band, stripe] = (C.colors && C.colors[team]) || ["#33413A", "#A9B3AC"];
    const crumbs = S.from === "board" ? [`<button type="button" data-ddback="board">← Tonight's board</button>`]
      : [`<button type="button" data-ddback="rank">← All defenses</button>`].concat(S.team ? [`<button type="button" data-ddback="team">← ${e(tName(S.team))}</button>`] : []);
    const tile = (lab, big, small, cls = "") => `<div class="dd-tile${cls}"><span>${lab}</span><b>${big}</b>${small ? `<small>${small}</small>` : ""}</div>`;
    const tiles = [];
    if (row) tiles.push(tile("Double-double tonight", pc(row.dd), `${row.was != null ? `was ${pc(row.was)} before your what-if · ` : ""}Triple-double ${pc(row.td)}`, " big"));
    else if (v0) tiles.push(tile("Double-double tonight", "Out", "Sitting in tonight's injury picture", " big"));
    if (h) {
      tiles.push(tile("Season", `${h.dd}<span style="font-size:16px;opacity:.7"> / ${h.gp}</span>`, `${pc(h.gp ? h.dd / h.gp : null)} of his games${h.td ? ` · ${h.td} triple-double${h.td === 1 ? "" : "s"}` : ""}`));
      tiles.push(tile("Last 10", `${l10dd(h.l10)}<span style="font-size:16px;opacity:.7"> / ${h.l10.length}</span>`, `Near misses this season: ${h.near}`));
      tiles.push(tile("How he gets them", PAIRS.map(([k]) => h.kind[k]).join(" · "), "PTS+REB · PTS+AST · REB+AST"));
      tiles.push(tile("10+ games", ST.map((s) => h.ten[s]).join(" · "), "PTS · REB · AST"));
    }
    const tn = tonight(n)[team];
    const hero = `<section class="tmhero" style="--tc:${band};--ts:${stripe}"><span class="tmwm" aria-hidden="true">${e(team)}</span>
      <div class="crumbs">${crumbs.join("")}</div>
      <div class="tmtop"><h2>${e(name)}<small>${e(tName(team))}${pos ? ` · ${e(pos)}` : ""}${tn ? ` · tonight ${tn.home ? "vs" : "@"} ${e(tn.opp)}` : ""}</small></h2></div>
      <div class="dd-tiles">${tiles.join("")}</div>${h ? `<p class="tmmeta">This season: ${f1(h.pts)} PTS, ${f1(h.reb)} REB, ${f1(h.ast)} AST in ${f1(h.min)} min a game.</p>` : ""}</section>`;
    let tonightCard = "";
    if (row) {
      const mu = row.wmu || row.mu, t = D ? D.teams.find((x) => x.team === row.opp) : null, R = D ? dranks(D) : null;
      const rk = R && t && R[row.pos] ? R[row.pos][row.opp] : null;
      const pairRows = PAIRS.map(([k, l]) => `<tr><td class="l">${l}</td><td class="gs share" style="--w:${Math.round(100 * (row.pair[k] || 0) / Math.max(0.01, row.dd))}"><b>${pc(row.pair[k])}</b></td></tr>`).join("");
      const statRows = ST.map((s, i) => `<tr><td class="l">${SL[s]}</td><td class="gs">${f1(mu[i])}</td><td class="tmh" style="--h:${Math.round(55 * row.q[i])}%">${pc1(row.q[i])}</td><td class="mut">${h ? `${h.ten[s]} of ${h.gp}` : "–"}</td></tr>`).join("");
      tonightCard = `<section class="card"><header><h3>Tonight</h3><span class="eyebrow">${row.home ? "vs" : "@"} ${e(tName(row.opp))}</span></header>
        <p class="cap">His projections from the Points, Rebounds and Assists boards and the chance each reaches 10, then the chance each pair does together (a triple-double counts in all three).${t ? ` ${e(tName(row.opp))} gives up ${f2(t.dd[row.pos] ?? t.dd.all)} double-doubles a game to ${POSN[row.pos] || "opponents"}${rk ? ` (${ord(rk)} most in the league)` : ""} and ${f2(t.dd.all)} in all.` : ""}</p>
        <div class="scroll"><table><thead><tr><th class="l">Stat</th><th class="gs">Projected</th><th>10+ chance</th><th>10+ this season</th></tr></thead><tbody>${statRows}</tbody></table></div>
        <div class="scroll"><table><thead><tr><th class="l">Pair</th><th class="gs">Both 10+</th></tr></thead><tbody>${pairRows}</tbody></table></div></section>`;
    }
    let games = "";
    if (h && h.l10.length) {
      const rows = h.l10.map((g) => {
        const [date, tm, opp, home, min, p, r, a] = g, n10 = [p, r, a].filter((x) => x >= 10).length;
        const c = (x) => `<td class="${x >= 10 ? "ten" : ""}">${x}</td>`;
        return `<tr><td class="pl">${md(date)}<small>${tm !== team ? e(tm) + " " : ""}${home ? "vs" : "@"} ${e(opp)}</small></td><td>${min}</td>${c(p)}${c(r)}${c(a)}<td class="gs ${n10 >= 2 ? "ok" : "no"}">${n10 === 3 ? "TD ✓" : n10 === 2 ? "DD ✓" : "–"}</td></tr>`;
      }).join("");
      const avg = (i) => h.l10.reduce((s, g) => s + g[i], 0) / h.l10.length;
      games = `<section class="card"><header><h3>Last ${h.l10.length} games</h3><span class="eyebrow">newest first</span></header>
        <div class="scroll"><table><thead><tr><th class="pl">Game</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th class="gs">DD</th></tr></thead>
        <tbody>${rows}<tr class="avg"><td class="pl">Average</td><td>${f1(avg(4))}</td><td>${f1(avg(5))}</td><td>${f1(avg(6))}</td><td>${f1(avg(7))}</td><td class="gs">${l10dd(h.l10)} of ${h.l10.length}</td></tr></tbody></table></div></section>`;
    } else if (!h) games = `<section class="card"><div class="empty"><p>No games this season for ${e(name)} yet.</p></div></section>`;
    return hero + tonightCard + games;
  }

  // ---------- Defenses ----------
  function rankHTML(D) {
    const n = C.night, T = tonight(n), R = dranks(D), lg = D.league;
    const sel = C.state.sel || [];
    let teams = D.teams.slice();
    if (sel.length) teams = teams.filter((t) => T[t.team] && sel.includes(T[t.team].game));
    else if (S.only) teams = teams.filter((t) => T[t.team]);
    const col = S.dcol, dir = S.ddir === "asc" ? -1 : 1;
    const key = (t) => (["all", "G", "F", "C"].includes(col) ? t.dd[col] : col === "td" ? t.td : col === "near" ? t.near : t.ten[col.slice(4)]);
    teams.sort((a, b) => dir * ((key(b) ?? -1) - (key(a) ?? -1)));
    const th = (k, l, cls = "", title = "") => `<th class="${cls}"${S.dcol === k ? ` aria-sort="${S.ddir === "asc" ? "ascending" : "descending"}"` : ""}${title ? ` title="${e(title)}"` : ""}><button type="button" class="sortb" data-dddsort="${k}">${l}</button></th>`;
    const cell = (t, k) => {
      const v = t.dd[k], r = R[k][t.team];
      if (v == null) return `<td class="mut${k === "all" ? " gs" : ""}">–</td>`;
      return `<td class="h${k === "all" ? " gs" : ""}${k === col ? " tot" : ""}" style="background:${C.heat(rankT(r, R[k].n))}" title="${e(`${tName(t.team)}: ${f2(v)} double-doubles a game to ${k === "all" ? "all players" : POSN[k]}, ${ord(r)} most (league ${f2(lg.dd[k])})`)}">${f2(v)}<small>${ord(r)}</small></td>`;
    };
    const body = teams.map((t, i) => {
      const tn = T[t.team];
      return `<tr><td class="rk">${S.ddir === "asc" ? teams.length - i : i + 1}</td>
        <td class="pl"><button type="button" class="link" data-ddteam="${e(t.team)}">${e(tName(t.team))}</button><small>${e(t.team)}</small></td>
        <td class="l">${tn ? `<button type="button" class="link" data-ddteam="${e(tn.opp)}">${tn.home ? "vs" : "@"} ${e(tn.opp)}</button>` : `<span class="mut">–</span>`}</td>
        ${["all", "G", "F", "C"].map((k) => cell(t, k)).join("")}
        <td class="gs">${f2(t.td)}</td><td>${f2(t.near)}</td>
        <td class="gs">${f2(t.ten.pts)}</td><td>${f2(t.ten.reb)}</td><td>${f2(t.ten.ast)}</td><td class="mut">${t.gp}</td></tr>`;
    }).join("");
    const posBtns = POS.map(([k, l]) => `<button type="button" data-dddsort="${k}" data-ddfix="1" aria-pressed="${col === k}">${k === "all" ? "Total" : l}</button>`).join("");
    const tn = n ? (n.games || []).length : 0;
    const scope = sel.length ? "" : `<div class="seg" role="group" aria-label="Teams"><button type="button" data-ddonly="0" aria-pressed="${!S.only}">All 30 teams</button><button type="button" data-ddonly="1" aria-pressed="${S.only}"${tn ? "" : " disabled"}>On the slate${tn ? ` (${tn * 2})` : ""}</button></div>`;
    return `<section class="card"><header><h3>Double-doubles allowed${["G", "F", "C"].includes(col) ? ` · ${POS.find((p) => p[0] === col)[1]}` : ""}</h3><span class="eyebrow">This season · through ${md(D.through)}</span></header>
      <p class="cap">Double-doubles each defense's opponents have put up per game, in total and by the opposing player's NBA.com position. <b>1st = gives up the most</b>, shaded green. <b>TD</b> is triple-doubles; <b>Near</b> is games where an opponent had one 10+ and another stat at 8 or 9. The 10+ columns are opposing players reaching 10 in that stat per game. League: ${f2(lg.dd.all)} double-doubles a game (${["G", "F", "C"].map((p) => `${POSN[p]} ${f2(lg.dd[p])}`).join(", ")}). Tap a team for every double-double it has allowed and tonight's opponents who could add one.${sel.length ? " Showing the games picked at the top." : ""}</p>
      <div class="dd-ctl"><span class="lab">Rank by</span><div class="seg" role="group" aria-label="Rank by position">${posBtns}</div>${scope}</div>
      <div class="scroll"><table><thead><tr><th class="mut" style="padding-left:16px;text-align:left">#</th><th class="pl">Defense</th><th class="l">Tonight</th>
        ${th("all", "DD/g", "gs", "Double-doubles allowed per game")}${th("G", "G")}${th("F", "F")}${th("C", "C")}${th("td", "TD/g", "gs", "Triple-doubles allowed per game")}${th("near", "Near", "", "Near misses allowed per game")}
        ${th("ten_pts", "10+ PTS", "gs", "Opposing players with 10+ points, per game")}${th("ten_reb", "10+ REB", "", "Opposing players with 10+ rebounds, per game")}${th("ten_ast", "10+ AST", "", "Opposing players with 10+ assists, per game")}<th class="mut">GP</th></tr></thead>
      <tbody>${body || `<tr><td colspan="14" class="mut" style="text-align:left;padding-left:16px">No teams on this night.</td></tr>`}</tbody></table></div></section>`;
  }

  function teamHTML(D) {
    const me = S.team, t = D.teams.find((x) => x.team === me), R = dranks(D), n = C.night, tn = tonight(n)[me];
    const [band, stripe] = (C.colors && C.colors[me]) || ["#33413A", "#A9B3AC"];
    const tile = (lab, big, small, cls = "") => `<div class="dd-tile${cls}"><span>${lab}</span><b>${big}</b>${small ? `<small>${small}</small>` : ""}</div>`;
    const tiles = t ? [tile("Double-doubles allowed", f2(t.dd.all), `a game · ${ord(R.all[me])} most · league ${f2(D.league.dd.all)}`, " big")]
      .concat(["G", "F", "C"].map((p) => tile(`To ${POSN[p]}`, f2(t.dd[p]), `${ord(R[p][me])} most · league ${f2(D.league.dd[p])}`)))
      .concat([tile("Triple-doubles", f2(t.td), `a game · near misses ${f2(t.near)}`), tile("By kind", PAIRS.map(([k]) => t.kind[k]).join(" · "), "PTS+REB · PTS+AST · REB+AST")]) : [];
    const hero = `<section class="tmhero" style="--tc:${band};--ts:${stripe}"><span class="tmwm" aria-hidden="true">${e(me)}</span>
      <div class="crumbs"><button type="button" data-ddback="rank">← All defenses</button></div>
      <div class="tmtop"><h2>${e(tName(me))}<small>${tn ? `${tn.home ? "vs" : "@"} ${e(tName(tn.opp))}${tn.tip ? ` · ${e(tn.tip)}` : ""} · ` : ""}${t ? `${t.gp} games` : ""}</small></h2></div>
      <div class="dd-tiles">${tiles.join("")}</div></section>`;
    let threat = "";
    if (tn && n && n.dd_index) {
      const rows = nightRows(n).filter((r) => r.opp === me).sort((a, b) => b.dd - a.dd);
      const body = rows.map((r) => `<tr><td class="pl"><button type="button" class="link" data-ddplayer="${e(r.pid)}" data-ddfrom="defense">${e(r.name)}</button><span class="pos">${e(r.pos)}</span></td>
        <td class="gs share" style="--w:${Math.round(100 * r.dd / Math.max(0.01, rows[0].dd))}"><b>${pc(r.dd)}</b></td><td class="l">${(() => { const b = best(r); return b && b.p >= 0.005 ? `${b.l} <span class="dim">${pc(b.p)}</span>` : "–"; })()}</td>
        ${ST.map((s, i) => `<td>${f1((r.wmu || r.mu)[i])}</td>`).join("")}</tr>`).join("");
      threat = `<section class="card"><header><h3>${e(tn.opp)} tonight</h3><span class="eyebrow">chances against ${e(me)}</span></header>
        <div class="scroll"><table><thead><tr><th class="pl">Player</th><th class="gs">DD</th><th class="l">Likeliest</th><th>PTS</th><th>REB</th><th>AST</th></tr></thead>
        <tbody>${body || `<tr><td colspan="6" class="mut" style="text-align:left;padding-left:16px">Nobody above 1%.</td></tr>`}</tbody></table></div></section>`;
    }
    const list = (t ? t.list : []).map((x) => {
      const [date, pid, name, tm, pos, p, r, a] = x;
      const c = (v) => `<td class="${v >= 10 ? "ten" : ""}">${v}</td>`;
      return `<tr><td class="pl">${D.players[String(pid)] ? `<button type="button" class="link" data-ddplayer="${e(pid)}" data-ddfrom="defense">${e(name)}</button>` : e(name)}${pos ? `<span class="pos">${e(pos)}</span>` : ""}<small>${e(tm)} · ${md(date)}</small></td>${c(p)}${c(r)}${c(a)}</tr>`;
    }).join("");
    const card = `<section class="card"><header><h3>Double-doubles allowed</h3><span class="eyebrow">${t ? t.list.length : 0} this season · newest first</span></header>
      <div class="scroll"><table><thead><tr><th class="pl">Player</th><th>PTS</th><th>REB</th><th>AST</th></tr></thead><tbody>${list || `<tr><td colspan="4" class="mut" style="text-align:left;padding-left:16px">None yet.</td></tr>`}</tbody></table></div></section>`;
    return hero + threat + card;
  }

  // ---------- Results ----------
  function resultsHTML() {
    const graded = (C.state.nights || []).filter((n) => n.status === "graded" && n.results && n.dd_index && Object.keys(n.dd_index).length);
    if (!graded.length) return `<section class="card"><header><h3>Double-doubles: results</h3></header><div class="empty"><p>Results show up here once a night with double-double chances is graded (the morning after the first one). Each band below should hit about as often as it says.</p></div></section>`;
    const bands = [[0, 0.05], [0.05, 0.15], [0.15, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 1.01]].map(([lo, hi]) => ({ lo, hi, n: 0, p: 0, y: 0 }));
    let tot = { n: 0, p: 0, y: 0, td: 0, tdp: 0 };
    const nightRowsH = graded.map((n) => {
      let cnt = 0, p = 0, y = 0, top = 0, topY = 0;
      Object.entries(n.dd_index).forEach(([pid, v]) => {
        const a = n.results[pid]; if (!a || !a.min) return;
        const r = ent(pid, v), hit = isDD(a) ? 1 : 0;
        cnt++; p += r.dd; y += hit; tot.td += isTD(a) ? 1 : 0; tot.tdp += r.td;
        if (r.dd >= 0.5) { top++; topY += hit; }
        const b = bands.find((x) => r.dd >= x.lo && r.dd < x.hi); if (b) { b.n++; b.p += r.dd; b.y += hit; }
      });
      tot.n += cnt; tot.p += p; tot.y += y;
      return `<tr><td class="pl"><button type="button" class="sortb" data-open="${e(n.id)}" style="color:var(--accent)">${e(C.fmtDate(n.id))}</button></td><td>${(n.games || []).length}</td><td>${cnt}</td><td class="gs">${f1(p)}</td><td>${y}</td><td class="mut">${top ? `${topY} of ${top}` : "–"}</td></tr>`;
    }).join("");
    const bandRows = bands.map((b) => `<tr><td class="pl">${Math.round(b.lo * 100)}–${b.hi > 1 ? 100 : Math.round(b.hi * 100)}%</td><td>${b.n}</td><td class="gs">${b.n ? pc(b.p / b.n) : "–"}</td><td>${b.n ? pc(b.y / b.n) : "–"}</td><td class="mut">${b.n ? `${b.y} of ${b.n}` : "–"}</td></tr>`).join("");
    return `<section class="card"><header><h3>Do the chances hold up?</h3><span class="eyebrow">${tot.n} player-games · ${graded.length} night${graded.length === 1 ? "" : "s"}</span></header>
      <p class="cap">Every posted chance, grouped by size, against how often those players actually got a double-double (players who played). A well-calibrated board has <b>Predicted</b> and <b>Hit</b> close in every row once there are a few hundred players in it. So far: ${tot.y} double-doubles vs ${f1(tot.p)} expected; ${tot.td} triple-doubles vs ${f1(tot.tdp)} expected.</p>
      <div class="scroll"><table><thead><tr><th class="pl">Chance</th><th>Players</th><th class="gs">Predicted</th><th>Hit</th><th>Count</th></tr></thead><tbody>${bandRows}</tbody></table></div></section>
      <section class="card"><header><h3>Night by night</h3></header><div class="scroll"><table><thead><tr><th class="pl">Night</th><th>Games</th><th>Players</th><th class="gs">Expected DDs</th><th>Actual</th><th>50%+ hit</th></tr></thead><tbody>${nightRowsH}</tbody></table></div></section>`;
  }

  function html(ctx) {
    C = ctx; css(); ensure();
    const tab = C.state.tab;
    if (tab === "results") return `<div class="dd">${resultsHTML()}</div>`;
    if (S.doc === undefined || S.doc === null) {
      if (tab === "board" && S.bview === "list") return `<div class="dd">${(C.banner || "")}${boardHTML(null)}</div>`;
      return `<p class="notice">Loading double-double history…</p>`;
    }
    const D = S.doc || null;
    if (tab === "board") {
      if (S.bview === "player" && S.pid) return `<div class="dd">${playerHTML(D)}</div>`;
      return `<div class="dd">${C.banner || ""}${boardHTML(D)}</div>`;
    }
    if (!D) return `<p class="notice">No double-double history yet. Run <code>python3 nba_dd.py build</code> in the nba-model folder (or wait for the next daily run), then reload.</p>`;
    const v = S.dview === "player" && S.pid ? playerHTML(D) : S.dview === "team" && S.team ? teamHTML(D) : rankHTML(D);
    return `<div class="dd">${v}</div>`;
  }

  const top = () => { try { document.getElementById("view").scrollIntoView({ block: "start" }); } catch (err) {} };
  document.addEventListener("click", (ev) => {
    if (!active()) return;
    const t = ev.target.closest("button");
    if (!t) return;
    const d = t.dataset;
    if (d.ddsort) {
      const k = d.ddsort;
      S.sort = S.sort.key === k ? { key: k, dir: S.sort.dir === "desc" ? "asc" : "desc" } : { key: k, dir: k === "name" ? "asc" : "desc" };
      C.render(); return;
    }
    if (d.ddpos) { S.pos = d.ddpos; save(); C.render(); return; }
    if (d.ddmin != null) { S.min = Number(d.ddmin); save(); C.render(); return; }
    if (d.ddonly) { S.only = d.ddonly === "1"; save(); C.render(); return; }
    if (d.dddsort) {
      if (d.ddfix) { S.dcol = d.dddsort; S.ddir = "desc"; }
      else { S.ddir = S.dcol === d.dddsort && S.ddir === "desc" ? "asc" : "desc"; S.dcol = d.dddsort; }
      C.render(); return;
    }
    if (d.ddplayer) {
      S.pid = String(d.ddplayer); S.from = d.ddfrom || C.state.tab;
      if (C.state.tab === "board") S.bview = "player"; else S.dview = "player";
      C.render(); top(); return;
    }
    if (d.ddteam) { S.team = d.ddteam; S.dview = "team"; C.render(); top(); return; }
    if (d.ddback) {
      if (d.ddback === "board") S.bview = "list"; else S.dview = d.ddback;
      C.render(); top(); return;
    }
  });

  window.DD_TAB = { html, chances, playerChances };
})();
