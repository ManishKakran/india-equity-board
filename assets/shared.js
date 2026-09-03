/* assets/shared.js -- code every DarwinOS page needs: the header/vitals bar,
   the FAE/score/forensic/validation badge ecosystem (shown on both My Portfolio's
   holdings table and General Portfolio's watchlist table), the modal popup system,
   the sticky quick-nav sidebar, the page footer, and the boot() bootstrap that
   fetches dashboard_data.json and re-renders. Split out of darwinos_dashboard.html
   on 2026-09-03 when the single tabbed
   board became 3 real pages (my_portfolio / general_portfolio / macro_intel),
   per explicit user direction -- see CLAUDE.md.

   Each page loads this via <script src="assets/shared.js"> BEFORE its own inline
   <script>, which declares `let DATA` and its own page-specific render()/boot()
   call. Classic (non-module) scripts on one page share one global scope, so
   functions defined here can reference `DATA` even though it's declared later,
   as long as they're only ever CALLED after that page's own script has run --
   true for every function below (none read DATA at top level, only inside
   function bodies invoked from render()/onclick handlers). */


/* Monitor verdict + Trace-a-Headline both route through serve.py's
   /api/run-monitor and /api/assess-news, which call adapter/llm_adapter.py
   (Gemini free tier) server-side -- the model call needs an API key, which
   this static file can never hold safely, so it can't be made client-side. */
async function callAdapter(path, payload){
  const res = await fetch(path,{
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify(payload)
  });
  const d = await res.json();
  if(!res.ok) throw new Error(d.error || ("server returned "+res.status));
  return d;
}


/* ============================================================= HELPERS */
const rupee = n => n==null? "—" : "₹"+Number(n).toLocaleString("en-IN");
const cr = n => n==null? "—" : (Math.abs(n)>=100000? (n/100000).toFixed(2)+" L cr" : Number(n).toLocaleString("en-IN")+" cr");
const pct = n => n==null? "—" : (n>0?"+":"")+n+"%";
const esc = s => (s||"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));

let quicknavObserver=null;
function buildQuickNav(){
  const secs=document.querySelectorAll(".sec");
  document.getElementById("quicknav").innerHTML = Array.from(secs).map((s,i)=>{
    const id="sec-"+(i+1);
    s.id=id;
    const title=s.querySelector("h2")?.textContent||"";
    return `<a href="#${id}" title="${esc(title)}"><b>${i+1}</b><span class="qnav-label">${esc(title)}</span></a>`;
  }).join("");
  initQuickNavScrollSpy(Array.from(secs));
}

/* highlights the quicknav link for whichever .sec is currently nearest the
   top of the viewport, so the sticky bar shows where you are in a long page
   -- re-observes on every render() since renderWatchlist()/etc. rebuild
   the .sec-following content but not the .sec headers themselves */
function initQuickNavScrollSpy(secs){
  if(quicknavObserver) quicknavObserver.disconnect();
  if(!secs.length || !("IntersectionObserver" in window)) return;
  const links=document.querySelectorAll("#quicknav a");
  const setActive=id=>links.forEach(a=>a.classList.toggle("active", a.getAttribute("href")==="#"+id));
  quicknavObserver=new IntersectionObserver(entries=>{
    entries.forEach(e=>{ if(e.isIntersecting) setActive(e.target.id); });
  },{rootMargin:"-50px 0px -75% 0px",threshold:0});
  secs.forEach(s=>quicknavObserver.observe(s));
}


/* renderVitals()/macroVitalHtml() moved OUT of shared.js and into
   darwinos_dashboard.html's own inline script (2026-09-03, per explicit user
   direction) -- the vitals bar (Book Health/Active Value/Portfolio XIRR/Nifty
   XIRR/Alpha vs Nifty/India Macro) is personal financial data (DATA.totals,
   DATA.holdings) and must never render on general_portfolio.html or
   macro_intel.html, since those two are the pages the user intends to publish
   as a public static site while My Portfolio stays local-only. Both pages'
   <div id="vitals"> container was removed from their HTML too -- see
   CLAUDE.md's "static publish" architecture note for the full picture. */

/* ============================================================= MODAL (deep FAE screen popup) */
function openModal(html){
  let ov=document.getElementById("modalOverlay");
  if(!ov){
    ov=document.createElement("div");
    ov.id="modalOverlay"; ov.className="modal-overlay";
    ov.innerHTML=`<div class="modal-box"><button class="modal-close" onclick="closeModal()" aria-label="Close">&times;</button><div id="modalBody"></div></div>`;
    ov.addEventListener("click", e=>{ if(e.target===ov) closeModal(); });
    document.addEventListener("keydown", e=>{ if(e.key==="Escape") closeModal(); });
    document.body.appendChild(ov);
  }
  document.getElementById("modalBody").innerHTML=html;
  ov.classList.add("show");
}
function closeModal(){
  const ov=document.getElementById("modalOverlay");
  if(ov) ov.classList.remove("show");
}


function classBand(cls){
  if(cls.startsWith("BUY")) return "buycand";
  if(cls.startsWith("PAUSE")||cls.startsWith("AVOID")) return "pause";
  if(cls.startsWith("MONITOR")) return "monitor";
  return "watch";
}


/* The hand-baked 5-entry FAE screen that used to live in EMBEDDED_DATA was dropped
   (framework_screen is now [] there) -- framework_screen.py's automated screen, fetched
   live from dashboard_data.json, is the only source now. Its rows key by real ticker
   symbol, but a holding/watchlist card's own `ticker` field can also carry a
   fundamentals_dir-style value in older seed data, so match against both. */
function screenRowFor(entry){
  const rows=DATA.framework_screen||[];
  return rows.find(r=> r.ticker===entry.ticker || (entry.fundamentals_dir && r.ticker===entry.fundamentals_dir)) || null;
}
function faeBadge(entry){
  const r=screenRowFor(entry);
  if(!r) return "";
  const args=`'${esc(entry.ticker)}','${esc(entry.fundamentals_dir||"")}'`;
  return `<span class="fae-badge" onclick="showFaeScreen(${args})" role="button" tabindex="0"
    onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();showFaeScreen(${args})}"
    title="Full FAE Gate 4.5 + Darwin/Nalanda screen">FAE Screen ↗</span>`;
}
/* score_companies.py's output, matched the same way as screenRowFor -- by ticker or
   fundamentals_dir. Components are 0-100 or null (never guessed when data's missing);
   components_scored tells you how much of the 6-part weight the overall number is
   actually resting on, so "56.5" from 2 components isn't mistaken for "56.5" from 6. */
const SCORE_LABELS={business_quality:"Business Quality",financial_strength:"Financial Strength",
  growth:"Growth",cash_generation:"Cash Generation",capital_allocation:"Capital Allocation",valuation:"Valuation"};
function scoreRowFor(ticker, fundamentals_dir){
  const rows=DATA.scores||[];
  return rows.find(r=> r.ticker===ticker || (fundamentals_dir && r.fundamentals_dir===fundamentals_dir)) || null;
}
function scoreBlockHtml(s){
  if(!s) return "";
  const bars=Object.entries(SCORE_LABELS).map(([key,label])=>{
    const v=s.components[key];
    const pct=v==null?0:Math.round(v);
    const cls=v==null?"na":v>=70?"pos":v>=45?"":"neg";
    return `<div class="score-row">
      <span class="score-label">${esc(label)}</span>
      <div class="score-track"><div class="score-fill ${cls}" style="width:${pct}%"></div></div>
      <span class="score-val ${cls}">${v==null?"—":Math.round(v)}</span>
    </div>`;
  }).join("");
  return `<div class="score-block">
    <div class="score-head"><span class="lbl">Component Score</span>
      <span class="score-overall">${s.overall==null?"—":s.overall}<span class="muted">/100</span></span></div>
    ${bars}
    <div class="muted" style="font-size:11px;margin-top:4px">${s.components_scored}/6 components scored
      (${esc(s.data_path)} data${s.quality_metric_used?` · quality via ${esc(s.quality_metric_used)}`:""})</div>
  </div>`;
}

/* reverse_dcf.py's output -- "what growth is the market already pricing in", only
   available for the 12 companies with darwin.db fundamentals (needs FCF/net debt/mcap). */
function reverseDcfRowFor(fundamentals_dir){
  if(!fundamentals_dir) return null;
  return (DATA.reverse_dcf||[]).find(r=>r.fundamentals_dir===fundamentals_dir) || null;
}
function reverseDcfBlockHtml(d){
  if(!d) return "";
  if(d.implied_growth_pct==null){
    return `<div class="score-block"><span class="lbl">Reverse DCF</span>
      <div class="muted" style="font-size:12px;margin-top:4px">${esc(d.note||"Not meaningful for this company.")}</div></div>`;
  }
  const hist=d.historical_revenue_cagr_pct;
  const gap=hist!=null?d.implied_growth_pct-hist:null;
  const gapNote=gap!=null?` (${gap>=0?"+":""}${gap.toFixed(1)}pp vs its own ${hist.toFixed(1)}%/yr historical revenue CAGR)`:"";
  const wd=d.wacc_detail||{};
  const betaNote = wd.beta!=null
    ? ` · Beta ${wd.beta.toFixed(2)} (${wd.beta_source==="computed"?"computed, 3y weekly vs Nifty 50":"fallback assumption, not yet computed"})`
    : "";
  const waccDetailNote = wd.override
    ? "manual override (flat, applied to every company)"
    : (wd.d_over_v!=null
        ? `computed: ${(wd.e_over_v*100).toFixed(0)}% equity @ ${(wd.re*100).toFixed(1)}% + ${(wd.d_over_v*100).toFixed(0)}% debt @ ${wd.rd!=null?(wd.rd*100).toFixed(1)+"%":"—"} after-tax`
        : "computed, all-equity (no leverage or financial-sector company)");
  return `<div class="score-block">
    <span class="lbl">Reverse DCF</span>
    <div style="margin-top:4px">Market is pricing in <b>${d.implied_growth_pct}%/yr</b> FCF growth${esc(gapNote)}
      <span class="muted" style="display:block;font-size:11px;margin-top:2px">
        WACC ${(d.wacc*100).toFixed(1)}% (${esc(waccDetailNote)}) · terminal growth ${(d.terminal_growth*100).toFixed(0)}% ·
        FCF proxy = CFO+CFI (FY${d.fcf_year})${esc(betaNote)}</span></div>
    ${d.note?`<div class="muted" style="font-size:11px;margin-top:4px">${esc(d.note)}</div>`:""}
  </div>`;
}

/* Score/reverse-DCF are keyed by ticker/fundamentals_dir directly (score_companies.py
   and reverse_dcf.py don't depend on framework_screen at all) -- so this badge/modal
   pair works for a holding even when it has no Darwin active-list entry (confirmed:
   6 of this repo's 11 holdings -- CARERATING/INDIGO/LT/MANAPPURAM/IEX/TANLA -- aren't
   in screening_candidates, so faeBadge()/showFaeScreen() above would silently show
   nothing for them; this is the fix). */
function scoreBadge(entry){
  // screenCardHtml() (behind faeBadge()) already embeds the score+DCF blocks, so only
  // show this standalone badge when there's no FAE Screen entry to fold into --
  // otherwise every framework_screen-covered holding would show two redundant badges.
  if(screenRowFor(entry)) return "";
  const s=scoreRowFor(entry.ticker, entry.fundamentals_dir);
  if(!s) return "";
  const args=`'${esc(entry.ticker)}','${esc(entry.fundamentals_dir||"")}'`;
  return `<span class="fae-badge" onclick="showScoreCard(${args})" role="button" tabindex="0"
    onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();showScoreCard(${args})}"
    title="Component score + reverse DCF">Score ↗</span>`;
}
/* apply_fae_reports.py writes fae_report_url onto whichever record it actually applied
   to -- a screening_candidate (-> framework_screen row) or a holding with no active-list
   entry (e.g. IEX). Checked both so this works everywhere a company might carry it. */
function faeReportUrlFor(ticker){
  const fs=(DATA.framework_screen||[]).find(r=>r.ticker===ticker);
  if(fs && fs.fae_report_url) return fs.fae_report_url;
  const h=(DATA.holdings||[]).find(x=>x.ticker===ticker);
  if(h && h.fae_report_url) return h.fae_report_url;
  return null;
}
function faeReportLinkHtml(ticker){
  const url=faeReportUrlFor(ticker);
  if(!url) return "";
  return `<div class="score-block"><a href="${esc(url)}" target="_blank" rel="noopener" class="scrbtn">Read full FAE report ↗</a></div>`;
}

function showScoreCard(ticker, fundamentals_dir){
  const s=scoreRowFor(ticker, fundamentals_dir);
  if(!s) return;
  const d=reverseDcfRowFor(s.fundamentals_dir);
  const p=piotroskiRowFor(s.fundamentals_dir);
  openModal(`<div class="scard-h">
      <div><h3>${esc(s.name||ticker)}</h3><div class="tk">${esc(ticker)}</div></div>
    </div>
    ${scoreBlockHtml(s)}
    ${reverseDcfBlockHtml(d)}
    ${piotroskiBlockHtml(p)}
    ${faeReportLinkHtml(ticker)}
    <div class="proposal">Proposal — you decide.</div>`);
}

/* piotroski_score.py's output -- deliberately a SEPARATE block from Component Score,
   never merged into Business Quality. Piotroski measures year-over-year TREND ("did
   this improve"), not absolute level -- confirmed against real data that a stable,
   already-excellent business (ITC, 35% ROCE) scores only 2/8 here despite scoring 77
   on the (absolute-level) Business Quality bar above, simply because it has little
   room left to keep improving. Presenting them as one number would make strong,
   mature companies look weak for reasons unrelated to their actual quality. */
const PIOTROSKI_LABELS={positive_net_income:"Net income positive",positive_cfo:"Operating cash flow positive",
  roa_improved:"ROA improved YoY",cfo_exceeds_net_income:"CFO exceeds net income (accruals check)",
  leverage_decreased:"Leverage fell YoY",no_dilution:"No new shares issued",
  asset_turnover_improved:"Asset turnover improved YoY",gross_margin_improved:"Gross margin improved YoY"};
function piotroskiRowFor(fundamentals_dir){
  if(!fundamentals_dir) return null;
  return (DATA.piotroski||[]).find(r=>r.fundamentals_dir===fundamentals_dir) || null;
}
function piotroskiBlockHtml(p){
  if(!p) return "";
  const rows=Object.entries(p.tests).map(([key,passed])=>
    `<li class="${passed?'p':'n'}">${esc(PIOTROSKI_LABELS[key]||key)}</li>`).join("");
  return `<div class="score-block">
    <div class="score-head"><span class="lbl">Piotroski F-Score <span class="muted">(year-over-year trend, not absolute quality)</span></span>
      <span class="score-overall">${p.score}<span class="muted">/${p.applicable}</span></span></div>
    <ul class="rlist" style="margin-top:6px">${rows}</ul>
    <div class="muted" style="font-size:11px;margin-top:4px">FY${p.as_of_year} vs prior year · current-ratio test excluded (Screener's export has no current-assets/liabilities split)${p.sector_type==='financial'?' · gross-margin test excluded (financial company)':''}</div>
  </div>`;
}

function screenCardHtml(r){
  const band=classBand(r.classification||"");
  const reasons=(r.reasons||[]).map(x=>`<li class="p">${esc(x)}</li>`).join("");
  const concerns=(r.concerns||[]).map(x=>`<li class="n">${esc(x)}</li>`).join("");
  const brk=(r.thesis_breakers||[]).map(x=>`<li>${esc(x)}</li>`).join("");
  const m=r.metrics||{};
  const score=scoreRowFor(r.ticker, r.fundamentals_dir);
  const dcf=reverseDcfRowFor(score&&score.fundamentals_dir);
  const piotroski=piotroskiRowFor(score&&score.fundamentals_dir);
  return `<div class="scard-h">
      <div><h3>${esc(r.name||r.ticker)}</h3><div class="tk">${esc(r.ticker)} · ${esc(m.period||"")}</div></div>
      <div class="cls ${band}">${esc(r.classification||"")}</div>
    </div>
    <div class="scard-meta">${esc(r.gate||"")}${r.quality_score?` · quality ${esc(r.quality_score)}`:""}${r.valuation?` · ${esc(r.valuation)}`:""}</div>
    ${(reasons||concerns)?`<ul class="rlist">${reasons}${concerns}</ul>`:""}
    ${brk?`<div class="brk"><span class="lbl">Thesis-breakers to track</span><ul class="kc">${brk}</ul></div>`:""}
    ${scoreBlockHtml(score)}
    ${reverseDcfBlockHtml(dcf)}
    ${piotroskiBlockHtml(piotroski)}
    ${faeReportLinkHtml(r.ticker)}
    <div class="proposal">Proposal — you decide.${r.next_for_full_fae?` <span class="muted">${esc(r.next_for_full_fae)}</span>`:""}</div>`;
}
function showFaeScreen(ticker, fundamentals_dir){
  const rows=DATA.framework_screen||[];
  const r=rows.find(x=> x.ticker===ticker || (fundamentals_dir && x.ticker===fundamentals_dir));
  if(!r) return;
  openModal(screenCardHtml(r));
}

/* FAE trigger worklist detail -- folded into the Watchlist card's own
   "🚩 Fundamentals changed" flag instead of a separate §-section duplicating
   the same DATA.fae_triggers list a second time on the page. */
function triggerRowFor(ticker){
  return (DATA.fae_triggers||[]).find(r=>r.ticker===ticker) || null;
}
function triggerCardHtml(r){
  const reasons=(r.reasons||[]).map(x=>`<li>${esc(x)}</li>`).join("");
  const c=r.current||{};
  return `<div class="scard-h">
      <div><h3>${esc(r.name||r.ticker)}</h3><div class="tk">${esc(r.ticker)}</div></div>
    </div>
    <ul class="kc" style="margin-top:10px">${reasons}</ul>
    <div class="note" style="margin-top:8px">Now: ${esc(c.classification||"—")} · ${c.pe!=null?c.pe+"x PE":"PE —"} · ${c.roce_pct!=null?c.roce_pct+"% ROCE":"ROCE —"}</div>
    <div class="proposal">Worklist item — not the full FAE Gates 1-5I engine. Start Gate 1 manually elsewhere.</div>`;
}
function showFaeTrigger(ticker){
  const r=triggerRowFor(ticker);
  if(!r) return;
  openModal(triggerCardHtml(r));
}

/* forensic_checks.py's red-flag scan (receivables/cash-conversion/leverage/dilution/
   other-income) -- same fold-into-existing-badge pattern as the FAE trigger worklist
   above, keyed by ticker against DATA.forensic_flags. */
function forensicRowFor(ticker){
  return (DATA.forensic_flags||[]).find(r=>r.ticker===ticker) || null;
}
const FORENSIC_SEVERITY_ORDER={high:0,medium:1,low:2};
function forensicCardHtml(r){
  const flags=(r.flags||[]).slice().sort((a,b)=>(FORENSIC_SEVERITY_ORDER[a.severity]??9)-(FORENSIC_SEVERITY_ORDER[b.severity]??9));
  const rows=flags.map(f=>`<li class="n"><span class="cls" style="margin-right:6px;font-size:10px;vertical-align:1px">${esc(f.severity||"")}</span>${esc(f.message)}</li>`).join("");
  return `<div class="scard-h">
      <div><h3>${esc(r.name||r.ticker)}</h3><div class="tk">${esc(r.ticker)} · ${esc(r.period||"")}</div></div>
    </div>
    <ul class="rlist">${rows||'<li class="p">No checks tripped.</li>'}</ul>
    <div class="proposal">Deterministic checks over Screener-sourced fundamentals — evidence for you to weigh, not a verdict.</div>`;
}
function showForensicFlags(ticker){
  const r=forensicRowFor(ticker);
  if(!r) return;
  openModal(forensicCardHtml(r));
}
/* Watchlist entries can carry a fundamentals_dir too (see screenRowFor above for
   the same match-both-ticker-and-fundamentals_dir reasoning) -- small badge next
   to the FAE Screen link, same click-for-modal pattern. */
function forensicBadge(entry){
  const rows=DATA.forensic_flags||[];
  const r=rows.find(x=> x.ticker===entry.ticker || (entry.fundamentals_dir && x.ticker===entry.fundamentals_dir));
  if(!r || !r.flag_count) return "";
  return `<span class="flag flag-trigger" style="cursor:pointer;margin-left:4px" onclick="showForensicFlags('${esc(r.ticker)}')" role="button" tabindex="0"
    onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();showForensicFlags('${esc(r.ticker)}')}"
    title="${r.flag_count} forensic check(s) tripped — click for detail">🚩${r.flag_count}</span>`;
}

/* fae_validation_check.py's output -- a ticker whose report made a dated forward
   forecast (its closing "finalized on ... FY----" note) whose fiscal year has now
   arrived. Same fold-into-a-small-badge pattern as forensicBadge above; only
   rendered once the status has actually moved past "not_due", so this stays
   silent for years at a time until it's genuinely relevant. */
function validationRowFor(ticker){
  return (DATA.fae_validation||[]).find(r=>r.ticker===ticker) || null;
}
const VALIDATION_STATUS_TEXT={
  due_awaiting_data:"The forecast period has arrived, but this year's actual results aren't loaded in yet.",
  ready_to_validate:"The forecast period has arrived and this year's actual results are available -- ready to check the forecast against reality now.",
};
function validationCardHtml(r){
  const label=r.status==="ready_to_validate"?"Ready to check":"Awaiting fresh data";
  return `<div class="scard-h">
      <div><h3>${esc(r.ticker)}</h3><div class="tk">Forecast check due</div></div>
      <div class="cls ${r.status==='ready_to_validate'?'buy':'watch'}">${esc(label)}</div>
    </div>
    <div class="scard-meta">Forecast dated ${esc(r.locked_on)} · covers ${esc(r.prediction_cycle)} · due ${esc(r.due_date)}</div>
    <div class="note" style="margin-top:8px">${esc(VALIDATION_STATUS_TEXT[r.status]||"")}</div>
    <div class="proposal">Ask for the forward-looking estimates in <code>${esc(r.report_path)}</code> to be checked against what actually happened. This badge only flags that it's due; it never does the check itself.</div>`;
}
function showFaeValidation(ticker){
  const r=validationRowFor(ticker);
  if(!r) return;
  openModal(validationCardHtml(r));
}
function validationBadge(entry){
  const r=validationRowFor(entry.ticker);
  if(!r || r.status==="not_due") return "";
  const overdue=r.status==="ready_to_validate";
  return `<span class="flag flag-trigger" style="cursor:pointer;margin-left:4px;${overdue?'':'opacity:.85'}" onclick="showFaeValidation('${esc(r.ticker)}')" role="button" tabindex="0"
    onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();showFaeValidation('${esc(r.ticker)}')}"
    title="The ${esc(r.prediction_cycle)} forecast in this report is due to be checked against actuals — click for detail">🕐 check forecast</span>`;
}

/* Guessing /company/<ticker>/ breaks for BSE-only listings, SME-board
   names, and companies whose Screener slug is a numeric BSE scrip code
   entirely (see fetch_screener_links.py) -- prefer the entry's resolved
   `screener_url` (fetched from Screener's own search API) and only fall
   back to the guess for an entry that hasn't been resolved yet. */
function screenerLink(entry){
  const ticker = typeof entry === "string" ? entry : entry.ticker;
  const href = (typeof entry === "object" && entry.screener_url) || `https://www.screener.in/company/${encodeURIComponent(ticker)}/`;
  return `<a class="scrbtn" href="${esc(href)}" target="_blank" rel="noopener">Screener ↗</a>`;
}

function renderFooter(){
  const g=DATA.generated||"—";
  document.getElementById("footer").innerHTML =
    `Data built ${g} from your DarwinOS <code>fundamentals.json</code> exports + vault snapshot. `+
    `Regenerate with <code>python build_dashboard_data.py</code> after any Screener refresh, then reload this page (served via <code>python serve.py</code>). `+
    `The board never trades and never edits a thesis — it watches, warns, and hands the decision to you.`;
}

function goToMacroRegions(){
  const el=document.getElementById("macro_regions");
  if(el){ el.scrollIntoView({behavior:"smooth"}); return; }
  location.href="macro_intel.html#macro_regions";
}
function scrollToHashTarget(){
  if(!location.hash) return;
  let el;
  try { el=document.querySelector(location.hash); } catch(e) { return; }
  if(el) el.scrollIntoView({behavior:"smooth"});
}
/* Every page calls boot(render) once its own render() is defined. Mirrors the
   single-file board's old bootstrap exactly: render once immediately (embedded
   snapshot on my_portfolio.html, empty on the other two), then fetch the real
   on-disk dashboard_data.json (works via serve.py; a bare file:// open can't
   fetch local files and silently no-ops here, same documented limitation the
   single-file board always had -- this board is always opened via serve.py in
   practice) and re-render with real data. Finally honours a #section-id in the
   URL, used by cross-page links like goToMacroRegions(). */
function boot(renderFn){
  renderFn();
  scrollToHashTarget();
  if(location.protocol!=="file:"){
    fetch("dashboard_data.json",{cache:"no-store"})
      .then(r=>r.ok?r.json():Promise.reject())
      .then(d=>{ DATA=d; renderFn(); scrollToHashTarget(); })
      .catch(()=>{});
  }
}
