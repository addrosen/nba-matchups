/* RA view: rebound chances and potential assists, alone and combined.
   Data: data/ra/all.js (nba_ra.py). Shown when the RA stat button (next to PRA) is picked:
   the page's render() calls window.RA_TAB.html(ctx) for the Board, Results and Defenses tabs.
   Everything else (state, clicks, styles) lives in this file. */
(function () {
  const S = { view: "rank", stat: "ra", col: "all", dir: "desc", only: false, team: null, side: "own", pid: null,
    psort: null, doc: undefined, adj: true, usage: {} };
  try { const v = JSON.parse(localStorage.getItem("ra-view") || "{}"); if (["ra", "reb_ch", "pot_ast"].includes(v.stat)) S.stat = v.stat; if (v.only) S.only = true; } catch (e) {}
  const save = () => { try { localStorage.setItem("ra-view", JSON.stringify({ stat: S.stat, only: S.only })); } catch (e) {} };
  let C = null;   // context from the page: state, esc, render, heat, colors, teams
  const active = () => C && C.state.stat === "ra" && ["board", "results", "defense"].includes(C.state.tab);

  const STAT = {
    ra: { pill: "Combined", label: "Rebound chances + potential assists", short: "RA ch", res: "ra_res", resLabel: "REB + AST", conv: "RA%",
      tip: "Rebound chances plus potential assists" },
    reb_ch: { pill: "Rebound chances", label: "Rebound chances", short: "Reb ch", res: "reb", resLabel: "Rebounds", conv: "REB%",
      tip: "Rebounds a player was within 3.5 feet of (NBA.com tracking)" },
    pot_ast: { pill: "Potential assists", label: "Potential assists", short: "Pot. AST", res: "ast", resLabel: "Assists", conv: "AST%",
      tip: "Passes to a teammate who shoots right away, made or missed (NBA.com tracking)" },
  };
  const POS = [["all", "Total"], ["G", "Guards"], ["F", "Forwards"], ["C", "Centers"]];
  const KEYS = POS.map((p) => p[0]);
  const f1 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toFixed(1));
  const pc = (x) => (x == null || isNaN(x) ? "–" : Math.round(x * 100) + "%");
  const ord = (n) => (n == null ? "–" : n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"));
  const sd = (x) => (x == null || isNaN(x) ? "–" : Math.abs(x) < 0.05 ? "±0.0" : (x > 0 ? "+" : "−") + Math.abs(x).toFixed(1));
  const md = (iso) => { const [, m, d] = iso.split("-").map(Number); return `${m}/${d}`; };
  const add = (a, b) => (a == null || b == null ? null : a + b);
  const e = (s) => C.esc(s);

  // Combined numbers: each part's per-game average added together (each part over its own
  // usable games), so the combined line always equals rebound chances + potential assists.
  function prep(D) {
    const sum2 = (x, y) => (x && y ? Object.fromEntries(KEYS.map((k) => [k, add(x[k], y[k])])) : null);
    D.teams.forEach((t) => {
      t.ra = sum2(t.reb_ch, t.pot_ast);
      t.ra_res = sum2(t.reb, t.ast);
      t.gp_ra = t.gp_reb_ch != null && t.gp_pot_ast != null ? Math.min(t.gp_reb_ch, t.gp_pot_ast) : null;
    });
    D.league.ra = sum2(D.league.reb_ch, D.league.pot_ast) || {};
    D.league.ra_res = sum2(D.league.reb, D.league.ast) || {};
    Object.values(D.players).forEach((p) => {
      p.ra = add(p.reb_ch, p.pot_ast);
      p.ra_res = add(p.reb, p.ast);
    });
    return D;
  }

  function css() {
    if (document.getElementById("ra-css")) return;
    const st = document.createElement("style");
    st.id = "ra-css";
    st.textContent = `
.ra { display: flex; flex-direction: column; gap: 14px; }
.ra-ctl { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; padding: 0 16px 12px; }
.ra-ctl .lab { font-family: var(--display); font-size: 13px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); margin-right: -6px; }
.ra td.h small, .ra td.tmh small { display: block; font-size: 11px; font-weight: 500; opacity: .75; }
.ra td.tot { font-weight: 700; }
.ra td.sel { box-shadow: inset 0 0 0 2px var(--ink); }
.ra .crumbs { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 13px; }
.ra .crumbs button { font: inherit; color: #fff; background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgb(255 255 255 / .5); }
.ra .tmhero h2 small { display: block; font-size: 17px; font-weight: 500; letter-spacing: .04em; margin-top: 6px; opacity: .85; text-transform: none; }
.ra-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 8px; }
.ra-tile { background: rgb(255 255 255 / .1); border: 1px solid rgb(255 255 255 / .22); border-radius: 4px; padding: 8px 10px; }
.ra-tile.big { background: rgb(255 255 255 / .18); border-color: rgb(255 255 255 / .4); }
.ra-tile b { display: block; font-family: var(--display); font-size: 28px; font-weight: 700; line-height: 1; }
.ra-tile span { font-size: 12px; opacity: .85; }
.ra-tile small { display: block; font-size: 11.5px; opacity: .8; margin-top: 3px; }
.ra-charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 4px 20px; padding: 0 16px 8px; }
.ra-chart h4 { margin: 0 0 4px; font-family: var(--display); font-size: 15px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--ink-2); }
.ra-chart svg { width: 100%; max-width: 440px; height: auto; display: block; overflow: visible; }
.ra-chart .k { display: flex; gap: 14px; font-size: 12px; color: var(--ink-2); margin-top: 2px; }
.ra-chart .k i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
.ra .bg { fill: var(--bar); } .ra .fg { fill: var(--accent); }
.ra .k .bgk { background: var(--bar); } .ra .k .fgk { background: var(--accent); }
.ra svg text { font-family: var(--body); font-size: 10px; fill: var(--ink-3); }
.ra svg text.v { fill: var(--ink-2); font-weight: 600; }
.ra tr.avg td { border-top: 2px solid var(--line-strong); font-weight: 600; }
.ra .pos { display: inline-block; min-width: 18px; text-align: center; font-size: 11px; font-weight: 600; color: var(--ink-2); border: 1px solid var(--line-strong); border-radius: 3px; padding: 0 3px; vertical-align: 1px; }
.ra td.pl .link { white-space: nowrap; }
.ra-inj { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; padding: 0 16px 12px; font-size: 13px; color: var(--ink-2); }
.ra-inj p { margin: 0; flex: 1 1 320px; }
.ra .tag { display: inline-block; margin-left: 6px; font-family: var(--display); font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; border: 1px solid currentColor; border-radius: 2px; padding: 0 4px; vertical-align: 1px; }
.ra .tag.out { color: var(--lo-ink); } .ra .tag.q { color: var(--ink-2); } .ra .tag.wi { color: var(--accent); }
.ra tr.isout td:not(.pl) { opacity: .5; }
.ra td small.up, .ra td small.dn { display: block; font-size: 11px; font-weight: 600; }
@media (max-width: 520px) { .ra-ctl { padding: 0 12px 12px; } .ra-tile b { font-size: 24px; } }`;
    document.head.appendChild(st);
  }

  function ensure() {
    if (S.doc !== undefined || !C.state.db) return;
    S.doc = null;
    C.state.db.doc("ra/all").get().then((s) => { S.doc = s.exists ? prep(s.data()) : false; }, () => { S.doc = false; })
      .then(() => { if (active()) C.render(); });
  }

  // tonight: team -> {opp, home, tip, game} on the night picked at the top of the page
  function tonight() {
    const n = (C.state.nights || []).find((x) => x.id === C.state.nightId);
    const m = {};
    ((n && n.games) || []).forEach((g) => {
      m[g.away] = { opp: g.home, home: false, tip: g.tip, game: g.game };
      m[g.home] = { opp: g.away, home: true, tip: g.tip, game: g.game };
    });
    return { map: m, night: n };
  }
  const tName = (t) => ((C.teams || []).find((x) => x.team === t) || {}).name || t;

  // ---------- injuries ----------
  // Same injury picture as the rest of the board for the night picked at the top: the posted
  // report (out/doubtful sit), your confirmed Questionable calls and your Injuries-tab what-ifs.
  // A player's season average was earned with whoever sat in his games, so it moves by
  //   (board's injury redistribution for tonight's outs) / (the same, averaged over the outs
  //    in the games he actually played)
  // for minutes, rebounds and assists (the board's calibrated ratios vs full strength).
  // Rebound chances move with rebounds and potential assists with assists. Who sat in each
  // game comes from the Teams tab files (data/usage/<TEAM>.js).
  function usageFor(team) {
    if (!(team in S.usage)) {
      S.usage[team] = undefined;
      C.state.db.doc("usage/" + team).get().then((x) => { S.usage[team] = x.exists ? x.data() : null; }, () => { S.usage[team] = null; })
        .then(() => { if (active()) C.render(); });
    }
    return S.usage[team];
  }
  function injFor(team) {
    const I = C.inj;
    if (!I || !I.night || !((I.night.games || []).some((g) => g.away === team || g.home === team))) return null;
    const outs = I.outs(team).map(String), off = I.official(team).map(String);
    const td = I.teamDoc(team), us = usageFor(team);
    return { team, outs, tests: outs.filter((x) => !off.includes(x)), back: off.filter((x) => !outs.includes(x)),
      ctx: td && td.inj ? td.inj : null, usage: us && us.games ? us : null, loading: td === undefined || us === undefined,
      report: (pid) => I.report(team, pid) };
  }
  function adjFor(pid, J) {
    if (!J || !J.ctx || !J.usage) return null;
    const games = J.usage.games.filter((g) => g.p && g.p[pid]);
    if (!games.length) return null;
    const R = (outs) => { const x = C.inj.ratios(J.ctx, pid, outs, "reb"), y = C.inj.ratios(J.ctx, pid, outs, "ast"); return [x[0], x[1], y[1]]; };
    const base = [0, 0, 0];
    games.forEach((g) => { const v = R((g.sat || []).map(String)); base[0] += v[0]; base[1] += v[1]; base[2] += v[2]; });
    const now = R(J.outs);
    const n = games.length, q = (i) => (base[i] > 0 ? now[i] / (base[i] / n) : 1);
    return { m: q(0), r: q(1), a: q(2) };
  }
  const dlt = (d) => (d == null || Math.abs(d) < 0.05 ? "" : `<small class="${d > 0 ? "up" : "dn"}">${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}</small>`);

  // ranks: 1 = gives up the most
  function ranks(D, stat) {
    const out = {};
    KEYS.forEach((k) => {
      const xs = D.teams.filter((t) => t[stat] && t[stat][k] != null).slice().sort((a, b) => b[stat][k] - a[stat][k]);
      out[k] = {}; xs.forEach((t, i) => (out[k][t.team] = i + 1));
      out[k].n = xs.length;
    });
    return out;
  }
  const rankT = (r, n) => (r == null || !n ? 0.5 : 1 - (r - 1) / Math.max(1, n - 1));

  // ---------- rankings ----------
  function rankHTML(D) {
    const st = S.stat, M = STAT[st], R = ranks(D, st), lg = D.league[st] || {};
    const T = tonight(), gp = "gp_" + st;
    const sel = C.state.sel || [];
    let teams = D.teams.filter((t) => t[st]);
    if (sel.length) teams = teams.filter((t) => T.map[t.team] && sel.includes(T.map[t.team].game));
    else if (S.only) teams = teams.filter((t) => T.map[t.team]);
    const dir = S.dir === "asc" ? -1 : 1, col = S.col;
    teams.sort((a, b) => dir * ((b[st][col] ?? -1) - (a[st][col] ?? -1)));
    const noPos = D.teams.every((t) => !t[st] || !(t[st].G || t[st].F || t[st].C));
    const th = (k, l) => {
      const sa = S.col === k ? ` aria-sort="${S.dir === "asc" ? "ascending" : "descending"}"` : "";
      return `<th class="${k === "all" ? "gs" : ""}"${sa}><button type="button" class="sortb" data-racol="${k}">${l}</button></th>`;
    };
    const posName = (k) => (k === "all" ? "all players" : POS.find((p) => p[0] === k)[1].toLowerCase());
    const cell = (t, k) => {
      const v = t[st][k], r = R[k][t.team];
      if (v == null || (k !== "all" && noPos)) return `<td class="mut${k === "all" ? " gs" : ""}">–</td>`;
      const diff = lg[k] != null ? v - lg[k] : null;
      return `<td class="h${k === "all" ? " gs" : ""}${k === col ? " tot" : ""}" style="background:${C.heat(rankT(r, R[k].n))}" title="${e(tName(t.team))}: ${f1(v)} a game to ${posName(k)}, ${ord(r)} most (league avg ${f1(lg[k])})">${f1(v)}<small>${ord(r)} · ${sd(diff)}</small></td>`;
    };
    // combined view: the two parts at the ranked position, so you can see what drives it
    const parts = (t) => {
      if (st !== "ra") return "";
      const a = t.reb_ch ? t.reb_ch[col] : null, b = t.pot_ast ? t.pot_ast[col] : null;
      return `<td class="gs">${f1(a)}</td><td>${f1(b)}</td>`;
    };
    const body = teams.map((t, i) => {
      const tn = T.map[t.team];
      const res = t[M.res] ? t[M.res][col] : null, conv = res != null && t[st][col] ? res / t[st][col] : null;
      return `<tr><td class="rk">${S.dir === "asc" ? teams.length - i : i + 1}</td>
        <td class="pl"><button type="button" class="link" data-rateam="${e(t.team)}">${e(tName(t.team))}</button><small>${e(t.team)}</small></td>
        <td class="l">${tn ? `<button type="button" class="link" data-rateam="${e(tn.opp)}">${tn.home ? "vs" : "@"} ${e(tn.opp)}</button>` : `<span class="mut">–</span>`}</td>
        ${KEYS.map((k) => cell(t, k)).join("")}${parts(t)}
        <td class="gs">${f1(res)}</td><td>${pc(conv)}</td><td class="mut">${t[gp] ?? "–"}</td></tr>`;
    }).join("");
    const pills = Object.entries(STAT).map(([k, m]) => `<button type="button" data-rastat="${k}" aria-pressed="${k === st}">${m.pill}</button>`).join("");
    const posBtns = POS.map(([k, l]) => `<button type="button" data-racol="${k}" data-rafix="1" aria-pressed="${k === col}">${l}</button>`).join("");
    const tn = T.night ? (T.night.games || []).length : 0;
    const scope = sel.length ? "" : `<div class="seg" role="group" aria-label="Teams"><button type="button" data-raonly="0" aria-pressed="${!S.only}">All 30 teams</button><button type="button" data-raonly="1" aria-pressed="${S.only}"${tn ? "" : " disabled"}>On the slate${tn ? ` (${tn * 2})` : ""}</button></div>`;
    const thr = st === "ra" ? (D.through.reb_ch && D.through.pot_ast ? (D.through.reb_ch < D.through.pot_ast ? D.through.reb_ch : D.through.pot_ast) : null) : D.through[st];
    const badList = st === "ra" ? (D.bad.reb_ch || []).concat(D.bad.pot_ast || []) : (D.bad[st] || []);
    const bad = badList.length ? ` Left out because NBA.com's numbers looked wrong: ${badList.map(e).join(", ")}.` : "";
    const missing = !thr ? `<p class="notice">No per-game ${M.label.toLowerCase()} yet. They're pulled from NBA.com on the next daily run (or run <code>python3 nba_ra.py all</code>).</p>` : "";
    const where = col === "all" ? "" : ` to ${posName(col)}`;
    const capWhat = st === "ra"
      ? `Rebound chances plus potential assists each defense gives up per game${where}: every opposing player added up (the two parts are each averaged over the games NBA.com has usable tracking for, then added).`
      : `${M.label} each defense gives up per game${where}: every opposing player added up.`;
    const resHead = st === "ra" ? `<th class="gs" title="${e(STAT.reb_ch.tip)}">Reb ch</th><th title="${e(STAT.pot_ast.tip)}">Pot. AST</th>` : "";
    return `<section class="card"><header><h3>${M.label} allowed${col === "all" ? "" : ` · ${POS.find((p) => p[0] === col)[1]}`}</h3><span class="eyebrow">This season${thr ? ` · through ${md(thr)}` : ""}</span></header>
      <p class="cap">${capWhat} Positions are the opposing player's NBA.com position. <b>1st = gives up the most</b>, shaded green. Under each number: its rank and the difference from the league average. <b>${M.resLabel}</b> and <b>${M.conv}</b> are what opponents turned those chances into${col === "all" ? "" : ` at that position`}. Tap a team to see its players.${sel.length ? " Showing the games picked at the top." : ""}${bad}</p>
      <div class="ra-ctl"><div class="seg" role="group" aria-label="Stat">${pills}</div>${scope}</div>
      <div class="ra-ctl"><span class="lab">Rank by</span><div class="seg" role="group" aria-label="Rank by position">${posBtns}</div></div>
      ${missing}
      <div class="scroll"><table><thead><tr><th class="mut" style="padding-left:16px;text-align:left">#</th><th class="pl">Defense</th><th class="l">Tonight</th>
        ${POS.map(([k, l]) => th(k, l)).join("")}${resHead}<th class="gs" title="${e(M.resLabel)} opponents got in those games">${M.resLabel}</th><th title="Share of those chances opponents converted">${M.conv}</th><th class="mut" title="Games with usable tracking">GP</th></tr></thead>
        <tbody>${body || `<tr><td colspan="13" class="mut" style="text-align:left;padding-left:16px">${thr ? "No teams on this night." : "Waiting on NBA.com tracking."}</td></tr>`}</tbody></table></div></section>`;
  }

  // ---------- team ----------
  const PCOLS = [["pos", "Pos"], ["gp", "GP"], ["min", "MIN"], ["ra", "RA ch"], ["ra_res", "RA/game"], ["reb_ch", "Reb ch"], ["reb", "REB"], ["reb_conv", "REB%"], ["pot_ast", "Pot. AST"], ["ast", "AST"], ["ast_conv", "AST%"]];
  const HEAT = ["ra", "ra_res", "reb_ch", "reb", "pot_ast", "ast"];
  const LEFT = new Set(["ra", "reb_ch", "pot_ast"]);
  function teamHTML(D) {
    const T = tonight(), me = S.team, tn = T.map[me];
    const show = S.side === "opp" && tn ? tn.opp : me;
    const [band, stripe] = (C.colors && C.colors[me]) || ["#33413A", "#A9B3AC"];
    const t = D.teams.find((x) => x.team === me);
    const tiles = t ? Object.entries(STAT).map(([k, m]) => {
      const R = ranks(D, k), v = t[k] ? t[k].all : null, lg = D.league[k] ? D.league[k].all : null;
      const pos = t[k] && ["G", "F", "C"].some((p) => t[k][p]) ? ["G", "F", "C"].map((p) => `${p} ${f1(t[k][p])} (${ord(R[p][me])})`).join(" · ") : "";
      return `<div class="ra-tile${k === "ra" ? " big" : ""}"><span>${m.label} allowed</span><b>${f1(v)}</b><small>${ord(R.all[me])} most · league ${f1(lg)}${pos ? `<br>${pos}` : ""}</small></div>`;
    }).join("") : "";
    const sides = tn ? `<div class="tmpills" role="group" aria-label="Players"><button type="button" data-raside="own" aria-pressed="${S.side !== "opp"}">${e(me)} players</button><button type="button" data-raside="opp" aria-pressed="${S.side === "opp"}">Tonight's opponent: ${e(tn.opp)}</button></div>` : "";
    const hero = `<section class="tmhero" style="--tc:${band};--ts:${stripe}"><span class="tmwm" aria-hidden="true">${e(me)}</span>
      <div class="crumbs"><button type="button" data-raback="rank">← All defenses</button></div>
      <div class="tmtop"><h2>${e(tName(me))}${tn ? `<small>${tn.home ? "vs" : "@"} ${e(tName(tn.opp))}${tn.tip ? ` · ${e(tn.tip)}` : ""}</small>` : ""}</h2></div>
      <div class="ra-tiles">${tiles}</div>${sides}</section>`;
    const J = injFor(show), adjOn = !!(J && J.ctx && J.usage && S.adj !== false);
    const ids = (D.rosters[show] || []).filter((p) => D.players[p]);
    const rows = ids.map((id) => {
      const base = D.players[id], out = !!(J && J.outs.includes(id));
      const r = { id, ...base, out, q: !!(J && !out && J.report(id) === "questionable"), test: !!(J && J.tests.includes(id)), d: {} };
      const a = adjOn && !out ? adjFor(id, J) : null;
      if (a) {
        if (base.min != null) r.min = base.min * a.m;
        ["reb_ch", "reb"].forEach((k) => { if (base[k] != null) r[k] = base[k] * a.r; });
        ["pot_ast", "ast"].forEach((k) => { if (base[k] != null) r[k] = base[k] * a.a; });
        r.ra = add(r.reb_ch, r.pot_ast); r.ra_res = add(r.reb, r.ast);
        ["min", "ra", "ra_res", "reb_ch", "reb", "pot_ast", "ast"].forEach((k) => { if (r[k] != null && base[k] != null) r.d[k] = r[k] - base[k]; });
      }
      return r;
    });
    const ps = S.psort || { key: S.stat, dir: "desc" };
    const val = (p, k) => (k === "pos" ? (p.pos || "~") : p[k]);
    rows.sort((a, b) => {
      if (a.out !== b.out) return a.out ? 1 : -1;          // players sitting tonight go to the bottom
      const A = val(a, ps.key), B = val(b, ps.key), d = ps.dir === "asc" ? 1 : -1;
      if (ps.key === "pos") return d * -String(A).localeCompare(String(B)) || (b.min - a.min);
      return d * ((A ?? -1) - (B ?? -1));
    });
    const live = rows.filter((r) => !r.out);
    const mx = {}; HEAT.forEach((k) => (mx[k] = Math.max(0, ...live.map((r) => r[k] || 0))));
    const th = PCOLS.map(([k, l]) => {
      const sa = ps.key === k ? ` aria-sort="${ps.dir === "asc" ? "ascending" : "descending"}"` : "";
      const tip = k === "ra_res" ? ` title="Rebounds plus assists per game"` : k === "ra" ? ` title="${e(STAT.ra.tip)}"` : k === "reb_ch" ? ` title="${e(STAT.reb_ch.tip)}"` : k === "pot_ast" ? ` title="${e(STAT.pot_ast.tip)}"` : "";
      return `<th class="${LEFT.has(k) ? "gs" : ""}${k === "pos" ? " l" : ""}"${sa}${tip}><button type="button" class="sortb" data-rapsort="${k}">${l}</button></th>`;
    }).join("");
    const td = (r, k) => {
      const v = r[k];
      if (k === "pos") return `<td class="l">${r.pos ? `<span class="pos" title="${e(r.pos_full)}">${e(r.pos)}</span>` : `<span class="mut">–</span>`}</td>`;
      if (k === "gp") return `<td class="mut">${v}</td>`;
      if (k === "min") return `<td>${f1(v)}${dlt(r.d.min)}</td>`;
      if (k.endsWith("_conv")) return `<td class="mut">${pc(v)}</td>`;
      if (v == null) return `<td class="mut${LEFT.has(k) ? " gs" : ""}">–</td>`;
      if (r.out) return `<td class="${LEFT.has(k) ? "gs" : ""}">${f1(v)}</td>`;
      const h = mx[k] > 0 ? Math.round(45 * v / mx[k]) : 0;
      const g = (k === "reb_ch" && r.gp_rc < r.gp) || (k === "pot_ast" && r.gp_pa < r.gp) ? `<small class="dim">${k === "reb_ch" ? r.gp_rc : r.gp_pa} gp</small>` : "";
      return `<td class="tmh${Math.abs(v - mx[k]) < 1e-9 ? " top" : ""}${LEFT.has(k) ? " gs" : ""}" style="--h:${h}%">${f1(v)}${dlt(r.d[k])}${g}</td>`;
    };
    const tag = (r) => r.out ? `<span class="tag ${r.test ? "wi" : "out"}" title="${r.test ? "Sitting in your what-if" : "Out tonight"}">${r.test ? "Out · what-if" : "Out"}</span>`
      : r.q ? `<span class="tag q" title="Questionable: assumed to play until you confirm">Q</span>` : "";
    const body = rows.map((r) => `<tr${r.out ? ' class="isout"' : ""}><td class="pl"><button type="button" class="link" data-raplayer="${e(r.id)}">${e(r.name)}</button>${tag(r)}</td>${PCOLS.map(([k]) => td(r, k)).join("")}</tr>`).join("");
    // who's out tonight, and the switch between tonight's numbers and plain season averages
    let injBar = "";
    if (J) {
      const nm = (pid) => (D.players[pid] && D.players[pid].name) || C.inj.name(show, pid) || "Player " + pid;
      const outs = J.outs.map((pid) => `${e(nm(pid))}${J.tests.includes(pid) ? " (your what-if)" : ""}`);
      const qs = ids.filter((id) => !J.outs.includes(id) && J.report(id) === "questionable").map((id) => e(nm(id)));
      const back = J.back.map((pid) => e(nm(pid)));
      const parts = [outs.length ? `<b>Out tonight:</b> ${outs.join(", ")}.` : `<b>Nobody is out tonight.</b>`];
      if (qs.length) parts.push(`<b>Questionable</b> (assumed to play): ${qs.join(", ")}.`);
      if (back.length) parts.push(`Playing in your what-if: ${back.join(", ")}.`);
      if (J.loading) parts.push(`Loading injury adjustments…`);
      else if (!J.ctx || !J.usage) parts.push(`No injury model for this team yet, so these are season averages.`);
      const sw = J.ctx && J.usage ? `<div class="seg" role="group" aria-label="Numbers"><button type="button" data-raadj="1" aria-pressed="${adjOn}">Tonight</button><button type="button" data-raadj="0" aria-pressed="${!adjOn}">Season averages</button></div>` : "";
      injBar = `<div class="ra-inj"><p>${parts.join(" ")}</p>${sw}<button type="button" class="btn" data-injteam="${e(show)}">Change who's out</button></div>`;
    }
    const capAdj = adjOn ? ` Numbers are adjusted for tonight's lineup: each player's season average moves by the board's injury redistribution for who's out tonight, compared with who was out in the games he actually played, so absences already in his average aren't counted twice. Small number = change from his season average. Players sitting are greyed out at the bottom.` : "";
    const card = `<section class="card"><header><h3>${e(tName(show))} players</h3><span class="eyebrow">${adjOn ? "Tonight · injuries applied" : "Season averages · this season"}</span></header>
      <p class="cap">Everyone on the current roster who has played. <b>RA ch</b> is rebound chances plus potential assists; <b>RA/game</b> is rebounds plus assists per game. Chances are averaged over the games NBA.com has tracking for (a smaller count shows under the number). REB% and AST% are how many of those chances became rebounds and assists.${capAdj} Tap a player for his last 10 games; tap a column to sort.</p>
      ${injBar}
      <div class="scroll"><table><thead><tr><th class="pl">Player</th>${th}</tr></thead><tbody>${body || `<tr><td class="mut" colspan="12" style="text-align:left;padding-left:16px">No players yet.</td></tr>`}</tbody></table></div></section>`;
    return hero + card;
  }

  // ---------- player ----------
  function chart(games, ch, res, chLab, resLab) {
    // oldest on the left; bar = chances, filled part = what he turned into the stat
    const g = games.slice().reverse(), n = g.length;
    const W = 320, H = 132, top = 14, bot = 30, ph = H - top - bot;
    const mx = Math.max(1, ...g.map((x) => Math.max(x[ch] ?? 0, x[res] ?? 0)));
    const bw = Math.min(22, (W / n) * 0.62), step = W / n;
    const y = (v) => top + ph - (v / mx) * ph;
    const bars = g.map((x, i) => {
      const cx = step * i + step / 2, a = x[ch], b = x[res];
      const back = a != null ? `<rect class="bg" x="${(cx - bw / 2).toFixed(1)}" y="${y(a).toFixed(1)}" width="${bw.toFixed(1)}" height="${(top + ph - y(a)).toFixed(1)}" rx="1.5"><title>${md(x.date)}: ${a} ${chLab.toLowerCase()}, ${b} ${resLab.toLowerCase()}</title></rect>` : "";
      const front = `<rect class="fg" x="${(cx - bw / 2 + (a != null ? 3 : 0)).toFixed(1)}" y="${y(b).toFixed(1)}" width="${(bw - (a != null ? 6 : 0)).toFixed(1)}" height="${(top + ph - y(b)).toFixed(1)}" rx="1"/>`;
      return `${back}${front}<text class="v" x="${cx.toFixed(1)}" y="${(y(a ?? b) - 3).toFixed(1)}" text-anchor="middle">${a ?? "–"}</text>
        <text x="${cx.toFixed(1)}" y="${H - bot + 12}" text-anchor="middle">${md(x.date)}</text><text x="${cx.toFixed(1)}" y="${H - bot + 24}" text-anchor="middle">${x.home ? "" : "@"}${e(x.opp)}</text>`;
    }).join("");
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${e(chLab)} and ${e(resLab)}, last ${n} games">${bars}<line x1="0" x2="${W}" y1="${top + ph}" y2="${top + ph}" stroke="var(--line-strong)"/></svg>
      <div class="k"><span><i class="bgk"></i>${e(chLab)} (number on top)</span><span><i class="fgk"></i>${e(resLab)}</span></div>`;
  }

  function playerHTML(D) {
    const p = D.players[S.pid];
    if (!p) { S.view = S.team ? "team" : "rank"; return S.team ? teamHTML(D) : rankHTML(D); }
    const F = D.l10_fields, games = p.l10.map((r) => {
      const x = Object.fromEntries(F.map((k, i) => [k, r[i]]));
      x.ra = add(x.reb_ch, x.pot_ast);
      return x;
    });
    const [band, stripe] = (C.colors && C.colors[p.team]) || ["#33413A", "#A9B3AC"];
    const avg = (k) => { const xs = games.map((x) => x[k]).filter((v) => v != null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
    const sum = (k, gate) => games.filter((x) => x[gate] != null).reduce((a, x) => a + (x[k] || 0), 0);
    const cRc = sum("reb_ch", "reb_ch"), cPa = sum("pot_ast", "pot_ast");
    const l10 = { reb_ch: avg("reb_ch"), reb: avg("reb"), pot_ast: avg("pot_ast"), ast: avg("ast"), min: avg("min"),
      reb_conv: cRc ? sum("reb", "reb_ch") / cRc : null, ast_conv: cPa ? sum("ast", "pot_ast") / cPa : null };
    l10.ra = add(l10.reb_ch, l10.pot_ast);
    const tile = (lab, k, convK, big) => `<div class="ra-tile${big ? " big" : ""}"><span>${lab}</span><b>${f1(l10[k])}</b><small>Season ${f1(p[k])}${convK && l10[convK] != null ? ` · ${pc(l10[convK])} converted` : ""}</small></div>`;
    const T = tonight(), tn = T.map[p.team];
    const J = injFor(p.team), isOut = !!(J && J.outs.includes(S.pid));
    let tonightTile = "";
    const A = !isOut ? adjFor(S.pid, J) : null;
    if (A && (Math.abs(A.r - 1) > 0.005 || Math.abs(A.a - 1) > 0.005)) {
      const nm = (pid) => { const x = (D.players[pid] && D.players[pid].name) || C.inj.name(p.team, pid) || ""; return x.split(" ").slice(1).join(" ") || x; };
      const rc = add(p.reb_ch != null ? p.reb_ch * A.r : null, p.pot_ast != null ? p.pot_ast * A.a : null);
      const rg = add(p.reb * A.r, p.ast * A.a);
      tonightTile = `<div class="ra-tile big"><span>${J.outs.length ? `Tonight without ${e(J.outs.map(nm).join(", "))}` : "Tonight, full strength"}</span><b>${f1(rc)}</b><small>RA ch (season ${f1(p.ra)})<br>RA/game ${f1(rg)} (season ${f1(p.ra_res)})</small></div>`;
    }
    const crumbs = [`<button type="button" data-raback="rank">← All defenses</button>`];
    if (S.team) crumbs.push(`<button type="button" data-raback="team">← ${e(tName(S.team))}</button>`);
    const hero = `<section class="tmhero" style="--tc:${band};--ts:${stripe}"><span class="tmwm" aria-hidden="true">${e(p.team)}</span>
      <div class="crumbs">${crumbs.join("")}</div>
      <div class="tmtop"><h2>${e(p.name)}<small>${e(tName(p.team))}${p.pos_full ? ` · ${e(p.pos_full)}` : ""}${tn ? ` · tonight ${tn.home ? "vs" : "@"} ${e(tn.opp)}` : ""}${isOut ? ` · <b>out tonight</b>${J.tests.includes(S.pid) ? " (your what-if)" : ""}` : ""}</small></h2></div>
      <div class="ra-tiles">${tonightTile}${tile("Reb chances + pot. AST", "ra", null, true)}${tile("Rebound chances", "reb_ch", "reb_conv")}${tile("Rebounds", "reb")}${tile("Potential assists", "pot_ast", "ast_conv")}${tile("Assists", "ast")}</div>
      <p class="tmmeta">Big numbers: average over his last ${games.length} game${games.length === 1 ? "" : "s"}; season averages underneath.</p></section>`;
    const mxa = Math.max(1, ...games.map((x) => x.ra || 0)), mxc = Math.max(1, ...games.map((x) => x.reb_ch || 0)), mxp = Math.max(1, ...games.map((x) => x.pot_ast || 0));
    const hc = (v, m, gs) => (v == null ? `<td class="mut${gs ? " gs" : ""}">–</td>` : `<td class="tmh${gs ? " gs" : ""}" style="--h:${Math.round(45 * v / m)}%">${v}</td>`);
    const rows = games.map((x) => {
      const rc = x.reb_ch, pa = x.pot_ast;
      return `<tr><td class="pl">${md(x.date)}<small>${x.team !== p.team ? e(x.team) + " " : ""}${x.home ? "vs" : "@"} ${e(x.opp)}</small></td><td>${x.min}</td>
        ${hc(x.ra, mxa, true)}
        ${hc(rc, mxc, true)}<td>${x.reb}</td><td class="mut">${rc ? pc(x.reb / rc) : "–"}</td>
        ${hc(pa, mxp, true)}<td>${x.ast}</td><td class="mut">${pa ? pc(x.ast / pa) : "–"}</td></tr>`;
    }).join("");
    const foot = `<tr class="avg"><td class="pl">Average</td><td>${f1(l10.min)}</td><td class="gs">${f1(l10.ra)}</td><td class="gs">${f1(l10.reb_ch)}</td><td>${f1(l10.reb)}</td><td class="mut">${pc(l10.reb_conv)}</td><td class="gs">${f1(l10.pot_ast)}</td><td>${f1(l10.ast)}</td><td class="mut">${pc(l10.ast_conv)}</td></tr>`;
    const anyTrk = games.some((x) => x.reb_ch != null || x.pot_ast != null);
    const charts = games.length ? `<div class="ra-charts"><div class="ra-chart"><h4>Rebounding</h4>${chart(games, "reb_ch", "reb", "Rebound chances", "Rebounds")}</div>
      <div class="ra-chart"><h4>Passing</h4>${chart(games, "pot_ast", "ast", "Potential assists", "Assists")}</div></div>` : "";
    const card = `<section class="card"><header><h3>Last ${games.length} games</h3><span class="eyebrow">newest first</span></header>
      <p class="cap">Each bar is his chances that night; the filled part is what he turned into rebounds or assists. <b>RA ch</b> is rebound chances plus potential assists. "–" means NBA.com hasn't posted tracking for that game yet${anyTrk ? " or its numbers looked wrong" : ""}.</p>
      ${charts}
      <div class="scroll"><table><thead><tr><th class="pl">Game</th><th>MIN</th><th class="gs" title="${e(STAT.ra.tip)}">RA ch</th><th class="gs" title="${e(STAT.reb_ch.tip)}">Reb ch</th><th>REB</th><th>REB%</th><th class="gs" title="${e(STAT.pot_ast.tip)}">Pot. AST</th><th>AST</th><th>AST%</th></tr></thead>
      <tbody>${rows}${games.length > 1 ? foot : ""}</tbody></table></div></section>`;
    return hero + card;
  }

  function html(ctx) {
    C = ctx; css(); ensure();
    if (S.doc === undefined || S.doc === null) return `<p class="notice">Loading rebound chances and potential assists…</p>`;
    if (S.doc === false) return `<p class="notice">No RA data yet. Run <code>python3 nba_ra.py all</code> in the nba-model folder (or wait for the next daily run), then reload.</p>`;
    const D = S.doc;
    const v = S.view === "player" ? playerHTML(D) : S.view === "team" && S.team ? teamHTML(D) : rankHTML(D);
    return `<div class="ra">${v}</div>`;
  }

  function go(view) { S.view = view; C.render(); try { document.getElementById("view").scrollIntoView({ block: "start" }); } catch (err) {} }

  document.addEventListener("click", (ev) => {
    if (!active()) return;
    const t = ev.target.closest("button");
    if (!t) return;
    const d = t.dataset;
    if (d.rastat) { S.stat = d.rastat; save(); C.render(); return; }
    if (d.raonly) { S.only = d.raonly === "1"; save(); C.render(); return; }
    if (d.racol) {
      if (d.rafix) { S.col = d.racol; S.dir = "desc"; }              // "Rank by" buttons: always most first
      else { S.dir = S.col === d.racol && S.dir === "desc" ? "asc" : "desc"; S.col = d.racol; }
      C.render(); return;
    }
    if (d.rateam) { S.team = d.rateam; S.side = "own"; S.psort = null; go("team"); return; }
    if (d.raside) { S.side = d.raside; C.render(); return; }
    if (d.raadj) { S.adj = d.raadj === "1"; C.render(); return; }
    if (d.rapsort) {
      const k = d.rapsort, ps = S.psort || { key: S.stat, dir: "desc" };
      S.psort = ps.key === k ? { key: k, dir: ps.dir === "desc" ? "asc" : "desc" } : { key: k, dir: "desc" };
      C.render(); return;
    }
    if (d.raplayer) { S.pid = d.raplayer; go("player"); return; }
    if (d.raback) { go(d.raback); return; }
  });

  window.RA_TAB = { html };
})();
