// ---- game sim ----
function simOneGame(myTeam, oppTeam, homeBoost=0, awayBoost=0){
  const isMyTeam = myTeam.name === state.myTeam.name;
  const isOppMyTeam = oppTeam.name === state.myTeam.name;

  const myBase = (isMyTeam && state.lines ? linesEffectiveness() : teamOVR(myTeam.roster))
    + homeBoost
    + (isMyTeam ? totalCoachSimBonus() : 0);
  const oppBase = (isOppMyTeam && state.lines ? linesEffectiveness() : teamOVR(oppTeam.roster))
    + awayBoost
    + (isOppMyTeam ? totalCoachSimBonus() : 0);

  const myStr  = myBase  + rnd(-10, 10);
  const oppStr = oppBase + rnd(-10, 10);

  // Offensive coach boosts goals-for; defensive coach reduces goals-against
  const myOffBonus  = isMyTeam  ? offensiveCoachBonus()  : 0;
  const myDefBonus  = isMyTeam  ? defensiveCoachBonus()  : 0;
  const oppOffBonus = isOppMyTeam ? offensiveCoachBonus() : 0;
  const oppDefBonus = isOppMyTeam ? defensiveCoachBonus() : 0;

  // Goalie coach multiplier applied to the opponent's goalie save effectiveness
  const myGoalieF  = isMyTeam  ? goalieCoachFactor() : 1.0;
  const oppGoalieF = isOppMyTeam ? goalieCoachFactor() : 1.0;

  const myAvg  = (2.5 + Math.max(0,(myStr-oppStr)*0.05)  + myOffBonus  - oppDefBonus)  * oppGoalieF;
  const oppAvg = (2.5 + Math.max(0,(oppStr-myStr)*0.05)  + oppOffBonus - myDefBonus)   * myGoalieF;

  let mg = Math.round(Math.max(0, myAvg  + (rnd(0,10)+rnd(0,10))/5 - 2));
  let og = Math.round(Math.max(0, oppAvg + (rnd(0,10)+rnd(0,10))/5 - 2));

  let result;
  let overtime = false;
  if(mg === og){
    overtime = true;
    const myWinsOT = Math.random() < 0.5 + (myStr - oppStr) * 0.005;
    if(myWinsOT){ mg++; } else { og++; }
  }

  if(mg > og){
    myTeam.w++;
    oppTeam.otl = (oppTeam.otl||0) + (overtime ? 1 : 0);
    if(!overtime) oppTeam.l = (oppTeam.l||0) + 1;
    result = 'W';
  } else {
    oppTeam.w++;
    myTeam.otl = (myTeam.otl||0) + (overtime ? 1 : 0);
    if(!overtime) myTeam.l = (myTeam.l||0) + 1;
    result = overtime ? 'OTL' : 'L';
  }

  // Update coaching staff tenure record for the player's team
  if(isMyTeam)      updateCoachingTenureRecord(result);
  if(isOppMyTeam)   updateCoachingTenureRecord(result === 'W' ? 'L' : result === 'L' ? 'W' : 'OTL');

  const isMyHome = isMyTeam;
  const isMyAway = isOppMyTeam;

  assignGoalsToTeam(myTeam,  mg, isMyHome, mg, og);
  assignGoalsToTeam(oppTeam, og, isMyAway, mg, og);

  assignPlusMinus(myTeam,  mg, og);
  assignPlusMinus(oppTeam, og, mg);

  myTeam.roster.forEach(p  => { if(p.pos !== 'G') { let s = getStatLine(p); s.gp = (s.gp||0)+1; } });
  oppTeam.roster.forEach(p => { if(p.pos !== 'G') { let s = getStatLine(p); s.gp = (s.gp||0)+1; } });

  return { result, mg, og, opp: oppTeam.name };
}
// ================================================================
// CALENDAR + WEEKLY SIMULATION ENGINE
// Master controller for all league flow and phase transitions.
// ================================================================


// ----------------------------------------------------------------
// CALENDAR — date-based season from Oct to Apr
// ----------------------------------------------------------------

function freshCalendar(year){
  return {
    year: year || 2025,
    phase: PHASES.PRESEASON,
    week: 1,
    currentMonth: 0,  // index into SEASON_MONTHS (0=September)
    currentDay: 1,    // September 1st — preseason start
    seasonStartFired: false,
    regularSeasonWeeks: REGULAR_SEASON_WEEKS,
    tradeDeadlineWeek:  TRADE_DEADLINE_WEEK,
    viewMonth: 0,
    tradeDeadlineFired: false,
    regularSeasonFired: false, // transition from preseason to regular season
  };
}

// Build a date key string
function dateKey(monthIdx, day){ return `${state.season}-${monthIdx}-${day}`; }

// Generate schedule: assign each game to a specific date (month+day)
// Returns: { byWeek: [[{home,away,month,day}]], byDate: { "monthIdx-day": [{home,away}] } }
function generateSchedule(){
  const teams = allTeams().map(t => t.name);
  const playCount = {};
  teams.forEach(a => teams.forEach(b => { playCount[a+'|'+b] = 0; }));

  const byWeek = [];   // array of weeks, each week = array of game objects
  const byDate = {};   // dateKey → [game objects]

  // Walk through each month/day and assign games on GAME_DAYS
  // September (mIdx=0) is preseason — no games scheduled there
  // Stop once the regular season ends (April 17)
  const rsEndSeasonDay = phaseDateToSeasonDay(PHASE_DATES.regularSeasonEnd.month, PHASE_DATES.regularSeasonEnd.day);
  for(let mIdx = 0; mIdx < SEASON_MONTHS.length; mIdx++){
    const month = SEASON_MONTHS[mIdx];
    if(mIdx === 0) continue; // September is preseason — skip game scheduling

    for(let day = 1; day <= month.days; day++){
      // dayOfSeason is absolute from Sep 1, so Oct 1 = day 30; (30+1)%7=3=Wednesday
      const dayOfSeason = SEASON_MONTHS.slice(0, mIdx).reduce((s,m)=>s+m.days,0) + day - 1;

      // Stop scheduling once we've passed the regular season end date
      if(dayOfSeason > rsEndSeasonDay) break;

      const dow = (dayOfSeason + 1) % 7; // Oct 1 2025 = Wednesday=3

      // Is this a game day?
      if(!GAME_DAYS.includes(dow)) continue;

      // Build week grouping: every 7 days = 1 week
      const wk = Math.floor(dayOfSeason / 7);
      while(byWeek.length <= wk) byWeek.push([]);

      // Schedule 16 games on this day (all 32 teams play)
      const available = [...teams];
      for(let i = available.length-1; i > 0; i--){
        const j = rnd(0, i);
        [available[i], available[j]] = [available[j], available[i]];
      }
      const used = new Set();
      while(available.length >= 2){
        const home = available.find(t => !used.has(t));
        if(!home) break;
        const candidates = available.filter(t => t !== home && !used.has(t));
        if(!candidates.length) break;
        candidates.sort((a,b) => playCount[home+'|'+a] - playCount[home+'|'+b]);
        const away = candidates[0];
        const game = { home, away, monthIdx: mIdx, day, monthName: month.name, season: state.season };
        byWeek[wk].push(game);
        const dk = dateKey(mIdx, day);
        if(!byDate[dk]) byDate[dk] = [];
        byDate[dk].push(game);
        playCount[home+'|'+away]++;
        playCount[away+'|'+home]++;
        used.add(home); used.add(away);
        available.splice(available.indexOf(home), 1);
        available.splice(available.indexOf(away), 1);
      }
    }
  }

  return { byWeek, byDate };
}

// ----------------------------------------------------------------
// PROCESS ONE WEEK — the core simulation unit
// Simulates ALL games in the current calendar week.
// ----------------------------------------------------------------
function processWeekGames(){
  const cal = state.calendar;
  const weekIdx = cal.week - 1;
  const weekGames = (state.schedule.byWeek && state.schedule.byWeek[weekIdx]) || [];
  let myResults = [];

  weekGames.forEach(g => {
    if(g.result) return; // already simmed via simDay — skip
    if(g.season !== undefined && g.season !== state.season) return; // wrong season
    const home = getTeamByName(g.home);
    const away = getTeamByName(g.away);
    if(!home || !away) return;
    const isMyHome = g.home === state.myTeam.name;
    const isMyAway = g.away === state.myTeam.name;
    const result = simOneGame(home, away);
    if(isMyHome || isMyAway){
      const myResult = isMyHome ? result.result : (result.result==='W'?'L':result.result==='L'?'W':'OTL');
      const myG = isMyHome ? result.mg : result.og;
      const oppG = isMyHome ? result.og : result.mg;
      const oppName = isMyHome ? g.away : g.home;
      // Store result on the game object for calendar display
      g.result = myResult; g.myG = myG; g.oppG = oppG;
      myResults.push({ result: myResult, myG, oppG, oppName, monthName: g.monthName, day: g.day });
      if(myResult==='W') state.morale = Math.min(5, state.morale+1);
      else if(myResult==='L') state.morale = Math.max(-5, state.morale-1);
    }
  });

  simAffiliateGame(state.ahl);
  simAffiliateGame(state.echl);
  // Development happens once at offseason (startOffseason), not weekly
  return myResults;
}

function showOffseasonTabs(){
  document.querySelectorAll('.nav-sub-btn.offseason-only').forEach(b=>b.classList.add('visible'));
}

// ----------------------------------------------------------------
// CHECK PHASE TRANSITIONS
// Called after each week/day advance — all transitions driven by
// the calendar's currentMonth + currentDay vs PHASE_DATES anchors.
// ----------------------------------------------------------------
function checkPhaseTransition(){
  const cal = state.calendar;
  const PD = PHASE_DATES;

  // ── Preseason → Regular Season (October 1st) ────────────────────
  if(cal.phase === PHASES.PRESEASON){
    if(!cal.regularSeasonFired && isOnOrAfterDate(cal, 'October', 1)){
      cal.regularSeasonFired = true;
      cal.phase = PHASES.REGULAR_SEASON;
      state.log.push('🏒 Regular Season begins!');
      showFlash('Regular Season!', "Puck drops — good luck, GM.", 'win');
      return true;
    }
    return false; // no further phase checks during preseason
  }

  // ── Regular Season ──────────────────────────────────────────────
  if(cal.phase === PHASES.REGULAR_SEASON){
    // Trade deadline (fires once)
    if(!cal.tradeDeadlineFired && isOnOrAfterDate(cal, PD.tradeDeadline.month, PD.tradeDeadline.day)){
      cal.tradeDeadlineFired = true;
      cal.phase = PHASES.TRADE_DEADLINE;
      state.log.push('🔔 Trade Deadline! Make your moves before the deadline passes.');
      showFlash('Trade Deadline!', 'Last chance to make trades.', 'otl');
      autoSimCheckDeadline();
      return true;
    }
    // End of regular season → Playoffs
    if(isOnOrAfterDate(cal, PD.regularSeasonEnd.month, PD.regularSeasonEnd.day + 1)){
      cal.phase = PHASES.PLAYOFFS;
      state.log.push('🏒 Regular season complete!');
      startPlayoffs();
      return true;
    }
  }

  // ── Trade Deadline → resume Regular Season ───────────────────
  if(cal.phase === PHASES.TRADE_DEADLINE){
    if(isOnOrAfterDate(cal, PD.tradeDeadlineEnd.month, PD.tradeDeadlineEnd.day)){
      cal.phase = PHASES.REGULAR_SEASON;
    }
  }

  // ── Offseason phase cascade (playoffs → draft → resign → FA → offseason) ─
  // These are normally triggered explicitly by the player completing tasks,
  // but if the calendar advances past a phase's start date we push forward.
  if(cal.phase === PHASES.PLAYOFFS){
    if(isOnOrAfterDate(cal, PD.draftDay.month, PD.draftDay.day)){
      cal.phase = PHASES.DRAFT;
      state.log.push('📋 Entry Draft is underway.');
      showOffseasonTabs();
      showTab('draft');
      showFlash('Entry Draft!', "It's June 26 — time to draft.", 'otl');
      autoSimCheckDraft();
    }
  }
  if(cal.phase === PHASES.DRAFT){
    if(isOnOrAfterDate(cal, PD.resignStart.month, PD.resignStart.day)){
      cal.phase = PHASES.RESIGN;
      state.log.push('✍️ Re-signing window is open.');
      showOffseasonTabs();
    }
  }
  if(cal.phase === PHASES.RESIGN){
    if(isOnOrAfterDate(cal, PD.freeAgencyStart.month, PD.freeAgencyStart.day)){
      cal.phase = PHASES.FREE_AGENCY;
      state.log.push('🏷️ Free agency is open!');
    }
  }
  if(cal.phase === PHASES.FREE_AGENCY){
    if(isOnOrAfterDate(cal, PD.offseasonStart.month, PD.offseasonStart.day)){
      cal.phase = PHASES.OFFSEASON;
      state.log.push('☀️ General offseason — prepare for next season.');
    }
  }
  // (Schedule is generated fresh at startNewSeason — no pre-generation needed)

  return false;
}

// ----------------------------------------------------------------
// CPU ROSTER MANAGEMENT — shared by simDay, simWeek, simToDeadline, simSeason
// Handles both in-season depth fill AND offseason upgrades.
//
// mode: 'inseason'  — conservative, fill holes only, cap-cautious
//        'offseason' — aggressive, upgrade starters, multiple waves
// ----------------------------------------------------------------
function cpuManageRosters(mode){
  if(!state || !state.fa) return;
  const cal = state.calendar;
  const isOffseason = (mode === 'offseason');
  const { NHL_MIN, AHL_MIN } = AFFILIATE_TIERS;

  // CPU will sign down to 65 OVR and route sub-NHL players to affiliates
  const MIN_OVR     = 65;
  const UPGRADE_OVR = 1; // any meaningful upgrade triggers a swap
  const ROSTER_MAX  = 23;
  const ROSTER_MIN  = 20; // allow rosters to dip a bit before emergency fill
  const WAVES       = isOffseason ? 5 : 2;

  function capRoom(team){ return BUDGET - team.roster.reduce((s,p) => s + p.salary, 0); }
  function worstAt(team, pos){ return team.roster.filter(p=>p.pos===pos).sort((a,b)=>a.ovr-b.ovr)[0]; }

  // Route a newly signed player to the correct level and log it
  function placeSigning(team, p, upgradeGain){
    if(!team.cpuAHL)  team.cpuAHL  = { roster: [] };
    if(!team.cpuECHL) team.cpuECHL = { roster: [] };

    let destination = 'NHL';
    if(p.ovr < AHL_MIN){
      p._affiliate = 'cpuECHL';
      team.cpuECHL.roster.push(p);
      destination = 'ECHL';
    } else if(p.ovr < NHL_MIN){
      p._affiliate = 'cpuAHL';
      team.cpuAHL.roster.push(p);
      destination = 'AHL';
    } else {
      p._affiliate = null;
      team.roster.push(p);
      // Trim overflow — worst OVR gets buried; goes through waivers if in-season
      while(team.roster.length > ROSTER_MAX){
        const worst = [...team.roster].sort((a,b) => a.ovr - b.ovr)[0];
        team.roster = team.roster.filter(x => x.id !== worst.id);
        if(!isOffseason && !isWaiverExempt(worst)){
          // Route through waivers during regular season
          cpuPlaceOnWaivers(team, worst);
        } else {
          if(worst.ovr >= AHL_MIN){
            worst._affiliate = 'cpuAHL';
            team.cpuAHL.roster.push(worst);
          } else {
            worst._affiliate = 'cpuECHL';
            team.cpuECHL.roster.push(worst);
          }
        }
      }
    }

    if(!state.faLog) state.faLog = [];
    const dateLabel = cal ? `${SEASON_MONTHS[cal.currentMonth].name.slice(0,3)} ${cal.currentDay}` : `Wk${state.week||1}`;
    const ovrLabel  = upgradeGain != null ? `${p.ovr} OVR ↑${upgradeGain}` : `${p.ovr} OVR`;
    const destLabel = destination === 'NHL' ? team.name
      : `${team.name} <span style="color:var(--text2);font-size:10px;">(${destination})</span>`;
    state.faLog.unshift(`<span style="color:var(--text2);">${dateLabel}</span> <span style="color:#fff;font-weight:600;">${p.name}</span> <span class="pos-badge" style="font-size:10px;padding:1px 5px;">${p.pos}</span> <span style="color:var(--text2);">${ovrLabel}</span> → <span style="color:var(--gold);">${destLabel}</span> <span style="color:var(--text2);">$${p.salary.toFixed(1)}M</span>`);
    if(state.faLog.length > 80) state.faLog.pop();
  }

  for(let wave = 0; wave < WAVES; wave++){
    const teams = [...state.others].sort(() => Math.random() - 0.5);

    teams.forEach(team => {
      const room = capRoom(team);
      if(room < league.minSalary) return;

      const needs = teamPositionNeeds(team);

      // 1. Fill open roster slots (up to ROSTER_MAX) and genuine positional holes
      if(team.roster.length < ROSTER_MAX){
        // Prefer positional holes first, then best available
        const topNeed = Object.entries(needs).sort((a,b)=>b[1]-a[1])[0];
        const targetPos = (topNeed && topNeed[1] >= 0.1) ? topNeed[0] : null;
        const best = state.fa.filter(p =>
          !p._myTeam && !p._signed &&
          (!targetPos || p.pos === targetPos) &&
          p.ovr >= MIN_OVR &&
          p.salary <= room
        ).sort((a,b)=>b.ovr-a.ovr)[0]
        // If no match for target position, fall back to any position
        || state.fa.filter(p =>
          !p._myTeam && !p._signed &&
          p.ovr >= MIN_OVR &&
          p.salary <= room
        ).sort((a,b)=>b.ovr-a.ovr)[0];

        if(best && Math.random() < (isOffseason ? 0.88 : 0.60)){
          best.years = contractYears(best.ovr, best.age);
          best._signed = true;
          placeSigning(team, best, null);
          return;
        }
      }

      // 2. Upgrade: sign a FA who beats an incumbent at the same position
      if(isOffseason || wave > 0){
        const positions = ['C','LW','RW','LD','RD','G'];
        for(const pos of positions){
          const worst = worstAt(team, pos);
          if(!worst) continue;

          const betterFA = state.fa.filter(p =>
            !p._myTeam && !p._signed &&
            p.pos === pos &&
            p.ovr >= worst.ovr + UPGRADE_OVR &&
            p.salary <= room + worst.salary &&
            p.ovr >= MIN_OVR
          ).sort((a,b)=>b.ovr-a.ovr)[0];

          if(betterFA && Math.random() < (isOffseason ? 0.75 : 0.45)){
            const cutIdx = team.roster.indexOf(worst);
            if(cutIdx !== -1){
              team.roster.splice(cutIdx, 1);
              worst._signed = false;
              worst._myTeam = false;
              // In-season: non-exempt players go through waivers; exempt go straight to minors
              if(!isOffseason && !isWaiverExempt(worst)){
                cpuPlaceOnWaivers(team, worst);
              } else if(isOffseason && worst.ovr >= NHL_MIN){
                state.fa.push(worst);
              } else {
                // Exempt (or offseason sub-threshold): route to affiliate minors
                if(!team.cpuAHL)  team.cpuAHL  = { roster: [] };
                if(!team.cpuECHL) team.cpuECHL = { roster: [] };
                if(worst.ovr >= AHL_MIN){
                  worst._affiliate = 'cpuAHL';
                  team.cpuAHL.roster.push(worst);
                } else {
                  worst._affiliate = 'cpuECHL';
                  team.cpuECHL.roster.push(worst);
                }
              }
              // sub-threshold players are released silently in offseason
            }
            betterFA.years = contractYears(betterFA.ovr, betterFA.age);
            betterFA._signed = true;
            placeSigning(team, betterFA, betterFA.ovr - worst.ovr);
            break;
          }
        }
      }
    });
  }

  // 3. Emergency fill: teams under roster minimum sign best available FA,
  // or generate a replacement-level player if FA pool is too thin
  state.others.forEach(team => {
    while(team.roster.length < ROSTER_MIN){
      const room = capRoom(team);
      const candidate = state.fa
        .filter(p => !p._myTeam && !p._signed && p.ovr >= MIN_OVR && p.salary <= room)
        .sort((a,b) => b.ovr-a.ovr)[0];
      if(candidate){
        candidate.years = contractYears(candidate.ovr, candidate.age);
        candidate._signed = true;
        placeSigning(team, candidate, null);
      } else {
        // FA pool dry — generate a depth filler (bottom-6 / bottom-pair calibre)
        const filler = newPlayer(null, rnd(76, 80));
        filler.years = rnd(1, 2);
        filler.salary = Math.max(league.minSalary, salFromOVR(filler.ovr));
        filler.capPct = salaryToCapPct(filler.salary);
        team.roster.push(filler);
      }
    }
  });


  // Remove all signed players from the FA pool and clean up temp flags
  state.fa = state.fa.filter(p => !p._signed);
  state.fa.forEach(p => { p._signed = false; });
  // Immediately refresh FA panel and signing log if they're visible
  const faPanel = document.getElementById('panel-fa');
  if(faPanel && faPanel.classList.contains('active')){
    renderFA();
  }
  // Always refresh the signing log element directly so it updates even when fa panel isn't active
  const logEntries = document.getElementById('fa-signing-log-entries');
  const logWrap    = document.getElementById('fa-signing-log');
  if(logEntries && state.faLog && state.faLog.length){
    if(logWrap) logWrap.style.display = 'block';
    logEntries.innerHTML = state.faLog.join('<br>');
  }
  const countEl = document.getElementById('fa-count');
  if(countEl) countEl.textContent = state.fa.length;
}

// ----------------------------------------------------------------
// CPU vs CPU TRADE ENGINE
// Runs every simmed week/day during regular season + trade deadline.
// Teams buy/sell based on playoff standing, targeting upgrades
// at positions of need. Picks are used as sweeteners.
// ----------------------------------------------------------------

// ================================================================
// CPU → PLAYER INCOMING TRADE OFFERS
// ================================================================
function cpuGenerateIncomingOffers(){
  if(!state || !state.others || !state.calendar) return;
  const cal = state.calendar;
  if(cal.phase !== PHASES.REGULAR_SEASON && cal.phase !== PHASES.TRADE_DEADLINE) return;
  if(!state.pendingCPUTrades) state.pendingCPUTrades = [];
  // No hard cap — offers expire naturally after 7 days via expireTradeOffers()

  const isDeadline = cal.phase === PHASES.TRADE_DEADLINE;
  const weekPct = Math.min(1, cal.week / (cal.regularSeasonWeeks || 28));

  // Determine whether to try a trade block offer vs a proactive unsolicited offer
  const hasPlayerBlock = tradeBlock && tradeBlock.size > 0;
  const hasPickBlock   = pickBlock  && pickBlock.size  > 0;
  const hasBlock = hasPlayerBlock || hasPickBlock;
  const blockOfferChance = isDeadline ? 0.70 : 0.12 + weekPct * 0.18;
  const proactiveChance  = isDeadline ? 0.30 : 0.03 + weekPct * 0.07;

  const rollBlock      = hasBlock && Math.random() < blockOfferChance;
  const rollProactive  = !rollBlock && Math.random() < proactiveChance;
  if(!rollBlock && !rollProactive) return;

  // Use the same scale as tradePlayerOVRValue / pickValueScore (50–4000+ range)
  function playerVal(p){
    if(!p) return 0;
    const ovr = p.ovr || 60; const age = p.age || 25; const yrs = p.years || 0;
    const cap = league.salaryCap || 104;
    const salaryCapPct = p.salary ? (p.salary / cap * 100) : playerCapPctFromOVR(ovr);
    const ovrMult = ovr>=95?26.0:ovr>=93?20.0:ovr>=92?16.0:ovr>=90?10.0:ovr>=87?5.0:ovr>=85?3.0:ovr>=82?1.4:ovr>=80?1.0:ovr>=75?0.7:0.5;
    const yrsMult = yrs>=6?1.3:yrs>=4?1.15:yrs>=3?1.0:yrs>=2?0.85:yrs>=1?0.75:0.5;
    const ageMult = age<=23?1.15:age<=27?1.1:age<=30?1.0:age<=32?0.85:0.7;
    return Math.max(1, Math.round(salaryCapPct * ovrMult * yrsMult * ageMult * 100));
  }

  // ── PICK BLOCK OFFER PATH ─────────────────────────────────────────
  // If a pick is on the block and we rolled a block offer, sometimes
  // the CPU will offer players/picks in return for your draft pick.
  if(rollBlock && hasPickBlock && (!hasPlayerBlock || Math.random() < 0.4)){
    const pickBlockIds = [...pickBlock];
    const targetPickId = pickBlockIds[Math.floor(Math.random() * pickBlockIds.length)];
    const myPicks = getTeamPicks(state.myTeam.name);
    const targetPick = myPicks.find(pk => pk.id === targetPickId);
    if(!targetPick){ pickBlock.delete(targetPickId); return; }
    if(state.pendingCPUTrades.find(o => o.targetPickId === targetPickId)) return;

    const targetPickVal = pickValueScore(targetPick);

    const sorted = [...state.others].sort((a,b) => pts(b) - pts(a));
    // Rebuilding teams (bottom half) are the buyers for picks
    const buyerPool = sorted.slice(Math.floor(sorted.length * 0.4));
    const offeror = buyerPool[Math.floor(Math.random() * buyerPool.length)];
    if(!offeror) return;

    // CPU builds a return package of players and/or picks matching the pick's value
    const targetReturn = targetPickVal * (0.85 + Math.random() * 0.30);
    let returnPlayer = null;
    let returnPlayerVal = 0;
    const returnPicks = [];
    let returnPickVal = 0;

    // Try to find a depth player that's close in value
    const playerOptions = offeror.roster
      .filter(p => p.ovr >= 70 && p.ovr <= 84 && canTrade(p, state.myTeam.name).allowed)
      .sort((a,b) => Math.abs(playerVal(a) - targetPickVal * 0.7) - Math.abs(playerVal(b) - targetPickVal * 0.7));
    if(playerOptions.length){
      const candidate = playerOptions[0];
      if(playerVal(candidate) <= targetPickVal * 1.2){
        returnPlayer = candidate;
        returnPlayerVal = playerVal(candidate);
      }
    }

    // Top up with picks if needed
    const offerorPicks = getTeamPicks(offeror.name).filter(pk => pk.round <= 4).sort((a,b) => a.round - b.round);
    for(const pk of offerorPicks){
      if(returnPlayerVal + returnPickVal >= targetReturn) break;
      returnPicks.push(pk);
      returnPickVal += pickValueScore(pk);
    }
    if(returnPlayerVal + returnPickVal < targetPickVal * 0.65) return;

    // Respect demand setting for this pick
    const pickDemand = tradeBlockDemands[targetPickId] || 'any';
    const hasRP   = !!returnPlayer;
    const hasRPks = returnPicks.length > 0;
    const hasR1pk = returnPicks.some(pk => pk.round === 1);
    if(pickDemand === 'players_only'    && !hasRP)          return;
    if(pickDemand === 'picks_only'      && hasRP)           return;
    if(pickDemand === 'picks_only'      && !hasRPks)        return;
    if(pickDemand === 'r1_only'         && !hasR1pk)        return;
    if(pickDemand === 'player_and_pick' && !(hasRP&&hasRPks)) return;

    const dateLabel = `${SEASON_MONTHS[cal.currentMonth].name.slice(0,3)} ${cal.currentDay}`;
    state.pendingCPUTrades.push({
      // Pick-target offer — different shape from player-target offer
      targetPickId, targetPickLabel: pickLabel(targetPick),
      targetName: pickLabel(targetPick), // reuse targetName for display
      offerorName: offeror.name,
      returnPlayer: returnPlayer ? { id:returnPlayer.id, name:returnPlayer.name, pos:returnPlayer.pos, ovr:returnPlayer.ovr, age:returnPlayer.age, salary:returnPlayer.salary, years:returnPlayer.years } : null,
      returnPicks: returnPicks.map(pk => ({ id:pk.id, round:pk.round, season:pk.season, originalTeam:pk.originalTeam, ownerTeam:pk.ownerTeam })),
      targetVal: targetPickVal, totalReturnVal: returnPlayerVal + returnPickVal, dateLabel,
      isPickOffer: true,
      sentDay: calSeasonDay(cal),
    });
    return;
  }

  let targetPlayer = null;
  let targetId = null;

  if(rollBlock){
    // Trade block offer — CPU responds to players you've listed
    const blockIds = [...tradeBlock];
    targetId = blockIds[Math.floor(Math.random() * blockIds.length)];
    targetPlayer = findInMyOrg(targetId);
    if(!targetPlayer){ tradeBlock.delete(targetId); return; }
  } else {
    // Proactive unsolicited offer — CPU scouts your roster and picks a target
    // Prefer 75+ OVR players not already targeted, skew toward players who can be moved
    const eligible = state.myTeam.roster.filter(p =>
      p.ovr >= 75 &&
      canTrade(p, null).allowed &&
      !state.pendingCPUTrades.find(o => o.targetId === p.id)
    ).sort((a,b) => b.ovr - a.ovr);
    if(!eligible.length) return;
    // Weight toward higher OVR players but don't always pick the best one
    const pickIdx = Math.floor(Math.pow(Math.random(), 1.5) * eligible.length);
    targetPlayer = eligible[pickIdx];
    if(!targetPlayer) return;
    targetId = targetPlayer.id;
  }

  if(state.pendingCPUTrades.find(o => o.targetId === targetId)) return;

  const targetVal = playerVal(targetPlayer);
  const sorted = [...state.others].sort((a,b) => pts(b) - pts(a));
  const buyerPool = sorted.slice(0, Math.ceil(sorted.length * 0.55));
  const offeror = buyerPool[Math.floor(Math.random() * buyerPool.length)];
  if(!offeror) return;

  const offerorCap = league.salaryCap - offeror.roster.reduce((s,p)=>s+p.salary,0);
  if(offerorCap < targetPlayer.salary * 0.5) return;

  const needs = teamPositionNeeds(offeror);
  const surplusPositions = Object.entries(needs).filter(([,v]) => v < 0.05).map(([pos]) => pos);
  let returnPlayer = null;
  for(const pos of surplusPositions){
    const options = offeror.roster.filter(p => p.pos === pos && p.ovr >= 70 && canTrade(p, state.myTeam.name).allowed).sort((a,b) => a.ovr - b.ovr);
    if(options.length > 1){ returnPlayer = options[0]; break; }
  }
  if(!returnPlayer){
    const options = offeror.roster.filter(p => p.ovr >= 70 && canTrade(p, state.myTeam.name).allowed).sort((a,b) => Math.abs(playerVal(a) - targetVal*0.75) - Math.abs(playerVal(b) - targetVal*0.75));
    if(options.length > 1) returnPlayer = options[0];
  }

  const returnPlayerVal = returnPlayer ? playerVal(returnPlayer) : 0;
  const returnPicks = [];
  let pickVal = 0;
  const offerorPicks = getTeamPicks(offeror.name).filter(pk => pk.round <= 3).sort((a,b) => a.round - b.round);
  const targetReturn = targetVal * (0.80 + Math.random() * 0.25);
  for(const pk of offerorPicks){
    if(returnPlayerVal + pickVal >= targetReturn) break;
    returnPicks.push(pk);
    pickVal += pickValueScore(pk);
  }
  if(returnPlayerVal + pickVal < targetVal * 0.70) return;

  // Respect the player's trade block demand before finalising the offer
  const demand = tradeBlockDemands[targetId] || 'any';
  const hasReturnPlayer = !!returnPlayer;
  const hasReturnPicks  = returnPicks.length > 0;
  const hasR1           = returnPicks.some(pk => pk.round === 1);
  if(demand === 'players_only'    && !hasReturnPlayer) return;
  if(demand === 'picks_only'      && hasReturnPlayer)  return;
  if(demand === 'picks_only'      && !hasReturnPicks)  return;
  if(demand === 'r1_only'         && !hasR1)           return;
  if(demand === 'player_and_pick' && !(hasReturnPlayer && hasReturnPicks)) return;

  const dateLabel = `${SEASON_MONTHS[cal.currentMonth].name.slice(0,3)} ${cal.currentDay}`;
  state.pendingCPUTrades.push({
    targetId, targetName: targetPlayer.name, offerorName: offeror.name,
    returnPlayer: returnPlayer ? { id:returnPlayer.id, name:returnPlayer.name, pos:returnPlayer.pos, ovr:returnPlayer.ovr, age:returnPlayer.age, salary:returnPlayer.salary, years:returnPlayer.years } : null,
    returnPicks: returnPicks.map(pk => ({ id:pk.id, round:pk.round, season:pk.season, originalTeam:pk.originalTeam, ownerTeam:pk.ownerTeam })),
    targetVal, totalReturnVal: returnPlayerVal + pickVal, dateLabel,
    sentDay: calSeasonDay(cal),
  });
}

function acceptIncomingOffer(idx){
  if(!state.pendingCPUTrades) return;
  const offer = state.pendingCPUTrades[idx];
  if(!offer) return;
  const offeror = state.others.find(t => t.name === offer.offerorName);
  if(!offeror){ declineIncomingOffer(idx); return; }

  // ── PICK OFFER (CPU wants your draft pick) ──────────────────────
  if(offer.isPickOffer){
    const myPickInv = state.pickInventory && state.pickInventory.find(p => p.id === offer.targetPickId);
    if(!myPickInv){ declineIncomingOffer(idx); return; }

    // Transfer your pick to the offeror
    myPickInv.ownerTeam = offeror.name;
    pickBlock.delete(offer.targetPickId);

    // Receive return player
    if(offer.returnPlayer){
      const rp = offeror.roster.find(p => p.id === offer.returnPlayer.id);
      if(rp){
        snapshotMidSeasonStats(rp, offeror.name);
        offeror.roster = offeror.roster.filter(p => p.id !== rp.id);
        state.myTeam.roster.push(rp);
      }
    }
    // Receive return picks
    offer.returnPicks.forEach(pk => {
      const inv = state.pickInventory && state.pickInventory.find(p => p.id === pk.id);
      if(inv) inv.ownerTeam = state.myTeam.name;
    });

    const recvParts = [offer.returnPlayer ? offer.returnPlayer.name : null, ...offer.returnPicks.map(pk => pickLabel(pk))].filter(Boolean);
    const recvStr = recvParts.join(', ') || '(picks only)';
    state.log.push(`📦 TRADE with ${offer.offerorName} — Sent: ${offer.targetPickLabel} | Received: ${recvStr}`);
    if(!state.tradeLog) state.tradeLog = [];
    state.tradeLog.unshift(`<span style="color:var(--text2);">${offer.dateLabel}</span> 📦 <span style="font-weight:600;color:#fff;">${offer.offerorName}</span> acquires <span style="color:#2ecc71;font-weight:600;">${offer.targetPickLabel}</span> from <span style="font-weight:600;">${state.myTeam.name}</span> for <span style="color:var(--gold);">${recvStr}</span>`);
    state.pendingCPUTrades = state.pendingCPUTrades.filter((_,i) => i !== idx);

    showFlash('Trade Complete!', `${offer.offerorName} deal accepted — received ${recvStr}`, 'otl');
    updateTradeOfferBadge();
    renderAll();
    renderTrade();
    return;
  }

  // ── PLAYER OFFER (CPU wants your player) ──────────────────────
  const targetPlayer = findInMyOrg(offer.targetId);
  if(!targetPlayer){ declineIncomingOffer(idx); return; }

  snapshotMidSeasonStats(targetPlayer, state.myTeam.name);
  removeFromMyOrg(offer.targetId);
  offeror.roster.push(targetPlayer);
  tradeBlock.delete(offer.targetId);

  if(offer.returnPlayer){
    const rp = offeror.roster.find(p => p.id === offer.returnPlayer.id);
    if(rp){
      snapshotMidSeasonStats(rp, offeror.name);
      offeror.roster = offeror.roster.filter(p => p.id !== rp.id);
      state.myTeam.roster.push(rp);
    }
  }
  offer.returnPicks.forEach(pk => {
    const inv = state.pickInventory && state.pickInventory.find(p => p.id === pk.id);
    if(inv) inv.ownerTeam = state.myTeam.name;
  });

  const recvParts = [offer.returnPlayer ? offer.returnPlayer.name : null, ...offer.returnPicks.map(pk => pickLabel(pk))].filter(Boolean);
  const recvStr = recvParts.join(', ') || '(picks only)';
  state.log.push(`📦 TRADE with ${offer.offerorName} — Sent: ${targetPlayer.name} | Received: ${recvStr}`);
  if(!state.tradeLog) state.tradeLog = [];
  state.tradeLog.unshift(`<span style="color:var(--text2);">${offer.dateLabel}</span> 📦 <span style="font-weight:600;color:#fff;">${offer.offerorName}</span> acquires <span style="color:#2ecc71;font-weight:600;">${targetPlayer.name}</span> from <span style="font-weight:600;">${state.myTeam.name}</span> for <span style="color:var(--gold);">${recvStr}</span>`);
  state.pendingCPUTrades = state.pendingCPUTrades.filter((o,i) => i !== idx && o.targetId !== offer.targetId);

  autoSetLines();
  showFlash('Trade Complete!', `${offer.offerorName} deal accepted — received ${recvStr}`, 'otl');
  updateTradeOfferBadge();
  renderAll();
  renderTrade();
}

function declineIncomingOffer(idx){
  if(!state.pendingCPUTrades) return;
  state.pendingCPUTrades.splice(idx, 1);
  updateTradeOfferBadge();
  renderTrade();
}

// ----------------------------------------------------------------
// CPU TRADE BLOCK MANAGEMENT — runs every week
// Each CPU team independently decides what to put on / take off
// their trade block based on cap situation, roster depth, and standing.
// Buyer/seller status (driven by standings) is kept separate.
// ----------------------------------------------------------------
function cpuUpdateTradeBlocks(){
  if(!state || !state.others || !state.calendar) return;
  const cal = state.calendar;
  // Only active during regular season and trade deadline
  if(cal.phase !== PHASES.REGULAR_SEASON && cal.phase !== PHASES.TRADE_DEADLINE) return;

  const allCPU = state.others;
  const sorted = [...allCPU].sort((a,b) => pts(b) - pts(a));
  const teamCount = sorted.length;

  allCPU.forEach(team => {
    if(!team.tradeBlock) team.tradeBlock = { playerIds: new Set(), pickIds: new Set() };
    const block = team.tradeBlock;
    const rank = sorted.indexOf(team);
    const standingPct = rank / Math.max(1, teamCount - 1); // 0 = top, 1 = bottom

    const capUsedByTeam = team.roster.reduce((s, p) => s + (p.salary || 0), 0);
    const capPct = capUsedByTeam / league.salaryCap;
    const isCapStrapped = capPct > 0.92;
    const isRebuilding = standingPct >= 0.65;
    const isContender  = standingPct <= 0.30;

    // --- PLAYERS ---
    // First remove players who have been traded away or no longer exist
    for(const id of [...block.playerIds]){
      if(!team.roster.find(p => p.id === id)) block.playerIds.delete(id);
    }

    team.roster.forEach(p => {
      const alreadyListed = block.playerIds.has(p.id);
      let shouldList = false;
      let shouldRemove = false;

      // Rebuilders list veterans (28+) with 1-2 years left — selling for picks/youth
      if(isRebuilding && p.age >= 28 && p.years <= 2 && p.ovr >= 74){
        shouldList = true;
      }

      // Cap-strapped teams list expensive players with low production value
      if(isCapStrapped && p.salary >= 4.5 && p.ovr < 80 && p.years <= 3){
        shouldList = true;
      }

      // Contenders list surplus depth (redundant position, lower OVR)
      if(isContender){
        const posCount = team.roster.filter(x => x.pos === p.pos).length;
        const IDEAL = { C:3, LW:3, RW:3, LD:3, RD:3, G:2 };
        const idealCount = IDEAL[p.pos] || 3;
        if(posCount > idealCount + 1 && p.ovr < 80){
          shouldList = true;
        }
      }

      // Any team might shop a misfit: high salary, declining age, expiring soon
      if(p.age >= 35 && p.years === 1 && p.ovr < 78){
        shouldList = true;
      }

      // Don't list top-2 players or the starting goalie
      const sortedByOVR = [...team.roster].sort((a,b) => b.ovr - a.ovr);
      if(sortedByOVR.indexOf(p) < 2) shouldList = false;
      if(p.pos === 'G'){
        const goalies = team.roster.filter(x => x.pos === 'G').sort((a,b) => b.ovr - a.ovr);
        if(goalies[0] === p) shouldList = false; // don't list starting goalie
      }

      // NMC prevents listing
      if(p.clause === 'NMC') shouldList = false;

      // Remove from block if situation has improved (team is now a contender and player is key)
      if(alreadyListed && isContender && p.ovr >= 82) shouldRemove = true;
      // Remove if they re-signed to a long-term deal
      if(alreadyListed && p.years >= 4) shouldRemove = true;

      if(shouldRemove) block.playerIds.delete(p.id);
      else if(shouldList) block.playerIds.add(p.id);
    });

    // Cap block size — don't list more than 4 players at once
    if(block.playerIds.size > 4){
      const excess = [...block.playerIds].slice(4);
      excess.forEach(id => block.playerIds.delete(id));
    }

    // --- PICKS ---
    // Remove picks that have been traded away
    for(const id of [...block.pickIds]){
      const stillOwned = state.pickInventory && state.pickInventory.find(pk => pk.id === id && pk.ownerTeam === team.name);
      if(!stillOwned) block.pickIds.delete(id);
    }

    // Contenders with cap room list future picks to attract sellers
    if(isContender){
      const theirPicks = getTeamPicks(team.name).filter(pk => pk.round <= 2 && pk.season > (state.season || 1));
      theirPicks.forEach(pk => block.pickIds.add(pk.id));
    } else {
      // Non-contenders clear picks from their block (they want to accumulate, not spend)
      block.pickIds.clear();
    }
  });
}

function cpuSimulateTrades(){
  if(!state || !state.others || !state.calendar) return;
  cpuGenerateIncomingOffers(); // generate offers for trade block players
  cpuGenerateIncomingOffers();
  const cal = state.calendar;
  const isDeadline = cal.phase === PHASES.TRADE_DEADLINE;

  // Only trade during regular season / deadline
  if(cal.phase !== PHASES.REGULAR_SEASON && cal.phase !== PHASES.TRADE_DEADLINE) return;

  // How many weeks into the season? Used to scale trade frequency.
  const weekPct = Math.min(1, cal.week / (cal.regularSeasonWeeks || 28));

  // Chance of a CPU trade attempt per week (ramps up toward deadline)
  const tradeChance = isDeadline ? 0.85 : 0.18 + weekPct * 0.30;
  if(Math.random() > tradeChance) return;

  // Sort teams by standing to identify buyers vs sellers
  const allCPU = [...state.others];
  const sorted = [...allCPU].sort((a,b) => pts(b) - pts(a));
  const teamCount = sorted.length;

  // Top third = buyers (want rentals, upgrades), bottom third = sellers (want picks/youth)
  function isBuyer(team){
    const rank = sorted.indexOf(team);
    return rank < teamCount * 0.40;
  }
  function isSeller(team){
    const rank = sorted.indexOf(team);
    return rank >= teamCount * 0.60;
  }

  // Player value calc — identical multipliers to tradePlayerOVRValue (50–4000+ range)
  function playerVal(p){
    if(!p) return 0;
    const ovr = p.ovr || 60;
    const age = p.age || 25;
    const yrs = p.years || 0;
    const cap = league.salaryCap || 104;
    const salaryCapPct = p.salary ? (p.salary / cap * 100) : playerCapPctFromOVR(ovr);
    const ovrMult = ovr>=95?26.0:ovr>=93?20.0:ovr>=92?16.0:ovr>=90?10.0:ovr>=87?5.0:ovr>=85?3.0:ovr>=82?1.4:ovr>=80?1.0:ovr>=75?0.7:0.5;
    const yrsMult = yrs>=6?1.3:yrs>=4?1.15:yrs>=3?1.0:yrs>=2?0.85:yrs>=1?0.75:0.5;
    const ageMult = age<=23?1.15:age<=27?1.1:age<=30?1.0:age<=32?0.85:0.7;
    return Math.max(1, Math.round(salaryCapPct * ovrMult * yrsMult * ageMult * 100));
  }

  // Shuffle CPU teams so different teams get first-mover advantage each week
  const shuffled = [...allCPU].sort(() => Math.random() - 0.5);

  // Try a limited number of trade attempts per tick
  const MAX_ATTEMPTS = isDeadline ? 4 : 2;
  let attempted = 0;

  for(const buyer of shuffled){
    if(attempted >= MAX_ATTEMPTS) break;
    if(!isBuyer(buyer)) continue;

    // Buyer identifies their biggest positional need
    const needs = teamPositionNeeds(buyer);
    const topNeed = Object.entries(needs).sort((a,b) => b[1]-a[1])[0];
    if(!topNeed || topNeed[1] < 0.15) continue;
    const neededPos = topNeed[0];

    // Find a trade partner — scan trade blocks first, then fall back to surplus logic
    for(const seller of shuffled){
      if(seller === buyer) continue;

      const sellerBlock = seller.tradeBlock;
      const hasBlock = sellerBlock && sellerBlock.playerIds && sellerBlock.playerIds.size > 0;

      // If seller has a trade block, check it first for players at neededPos
      // Any team with a block is open to dealing, regardless of standing
      // If no block, fall back to the old standing-based seller check
      const isOpenToDealing = hasBlock || isSeller(seller) || isDeadline;
      if(!isOpenToDealing) continue;

      let targetPlayer = null;

      if(hasBlock){
        // Prefer block players at neededPos — seller has explicitly signalled availability
        const blockCandidates = [...sellerBlock.playerIds]
          .map(id => seller.roster.find(p => p.id === id))
          .filter(p => p && p.pos === neededPos && p.ovr >= 75 && canTrade(p, buyer.name).allowed)
          .sort((a,b) => b.ovr - a.ovr);
        if(blockCandidates.length) targetPlayer = blockCandidates[0];
      }

      // Fallback: use old surplus logic if block didn't yield a match
      if(!targetPlayer){
        const candidates = seller.roster
          .filter(p => p.pos === neededPos && p.ovr >= 75 && canTrade(p, buyer.name).allowed)
          .sort((a,b) => b.ovr - a.ovr);
        if(!candidates.length) continue;
        const posPlayers = seller.roster.filter(p => p.pos === neededPos).sort((a,b) => b.ovr - a.ovr);
        targetPlayer = posPlayers.length >= 2
          ? candidates.find(p => p !== posPlayers[0])
          : (isSeller(seller) ? posPlayers[0] : null);
      }

      if(!targetPlayer) continue;

      const offerVal = playerVal(targetPlayer);

      // Buyer assembles return package: one player at a surplus position + picks
      const buyerSurplus = Object.entries(needs)
        .filter(([,v]) => v < 0.1) // positions buyer is deep at
        .map(([pos]) => pos);

      // Find a player from buyer to send back
      let returnPlayer = null;
      for(const surplusPos of buyerSurplus){
        const options = buyer.roster
          .filter(p => p.pos === surplusPos && p.ovr >= 72 && canTrade(p, seller.name).allowed)
          .sort((a,b) => a.ovr - b.ovr); // send the weakest surplus player
        if(options.length > 1){ // keep at least one
          returnPlayer = options[0];
          break;
        }
      }

      let returnVal = returnPlayer ? playerVal(returnPlayer) : 0;

      // Add picks to balance if needed
      const picksToSend = [];
      const buyerPicks = getTeamPicks(buyer.name)
        .filter(pk => pk.round <= 3) // only quality picks as sweetener
        .sort((a,b) => a.round - b.round);

      let pickVal = 0;
      if(returnVal < offerVal * 0.75){
        // Need picks to make up the difference
        for(const pk of buyerPicks){
          if(returnVal + pickVal >= offerVal * 0.85) break;
          picksToSend.push(pk);
          pickVal += pickValueScore(pk) * 1; // picks now on same scale as player values
        }
      }

      const totalReturnVal = returnVal + pickVal;

      // Is it a fair enough deal? (within 20% value)
      const valueFair = totalReturnVal >= offerVal * 0.80;
      if(!valueFair) continue;

      // Execute the trade
      attempted++;

      // Move target player to buyer
      snapshotMidSeasonStats(targetPlayer, seller.name);
      const sellerIdx = seller.roster.indexOf(targetPlayer);
      if(sellerIdx !== -1) seller.roster.splice(sellerIdx, 1);
      buyer.roster.push(targetPlayer);

      // Clean traded player off seller's trade block
      if(seller.tradeBlock && seller.tradeBlock.playerIds){
        seller.tradeBlock.playerIds.delete(targetPlayer.id);
      }

      // Move return player to seller (if any)
      if(returnPlayer){
        snapshotMidSeasonStats(returnPlayer, buyer.name);
        const buyerIdx = buyer.roster.indexOf(returnPlayer);
        if(buyerIdx !== -1) buyer.roster.splice(buyerIdx, 1);
        seller.roster.push(returnPlayer);
        // Clean return player off buyer's block too if listed
        if(buyer.tradeBlock && buyer.tradeBlock.playerIds){
          buyer.tradeBlock.playerIds.delete(returnPlayer.id);
        }
      }

      // Transfer picks
      picksToSend.forEach(pk => {
        const inv = state.pickInventory && state.pickInventory.find(p => p.id === pk.id);
        if(inv) inv.ownerTeam = seller.name;
      });

      // Log the trade
      const dateLabel = `${SEASON_MONTHS[cal.currentMonth].name.slice(0,3)} ${cal.currentDay}`;
      const pickStr = picksToSend.length ? ' + ' + picksToSend.map(pk => pickLabel(pk)).join(', ') : '';
      const returnStr = returnPlayer ? returnPlayer.name : '';
      const sentStr = [returnStr, ...picksToSend.map(pk => pickLabel(pk))].filter(Boolean).join(', ');

      const tradeLogEntry = `<span style="color:var(--text2);">${dateLabel}</span> 📦 <span style="font-weight:600;color:#fff;">${buyer.name}</span> acquires <span style="color:#2ecc71;font-weight:600;">${targetPlayer.name}</span> <span style="color:var(--text2);">(${targetPlayer.pos} · ${targetPlayer.ovr} OVR)</span> from <span style="font-weight:600;">${seller.name}</span>${sentStr ? ` for <span style="color:var(--gold);">${sentStr}</span>` : ''}`;

      if(!state.tradeLog) state.tradeLog = [];
      state.tradeLog.unshift(tradeLogEntry);
      if(state.tradeLog.length > 60) state.tradeLog.pop();

      // Also push to game log so player sees it
      state.log.push(`<span class="wk">${dateLabel}</span> 📦 Trade: <strong>${buyer.name}</strong> gets ${targetPlayer.name} from ${seller.name}${sentStr ? ' for ' + sentStr : ''}`);

      // Refresh trade log UI if visible
      const tradeLogEl = document.getElementById('cpu-trade-log-entries');
      const tradeLogWrap = document.getElementById('cpu-trade-log');
      if(tradeLogEl && state.tradeLog.length){
        if(tradeLogWrap) tradeLogWrap.style.display = 'block';
        tradeLogEl.innerHTML = state.tradeLog.join('<br>');
      }

      break; // this buyer made a deal, move to next buyer
    }
  }
}


// ---- Sim Playoff Games for a time window ----
// Only sims a game in a series if the current calendar day has reached
// that game's scheduled day (startSeasonDay + gamesPlayed * 2).
// Stamps the game with its scheduled date, not whatever day you pressed sim.
function simPlayoffGamesForPeriod(slots){
  if(!state.playoffsStarted || !state.bracket) return [];
  const myName = state.myTeam.name;
  const myResults = [];
  const bracket = state.bracket;
  const currentRound = bracket.rounds[bracket.rounds.length - 1];
  const cal = state.calendar;
  const todaySeasonDay = SEASON_MONTHS.slice(0, cal.currentMonth).reduce((a, m) => a + m.days, 0) + cal.currentDay - 1;

  for(let slot = 0; slot < slots; slot++){
    let anySimmed = false;
    currentRound.forEach(s => {
      if(s.done) return;
      if(!s.startSeasonDay){
        const playoffsBase = phaseDateToSeasonDay('April', 18);
        s.startSeasonDay = playoffsBase + (bracket.rounds.length - 1) * 16;
      }
      if(!s.games) s.games = [];
      if(s.homeW >= 4 || s.awayW >= 4) return;

      // Compute what season day this next game is scheduled for
      const nextGameSeasonDay = s.startSeasonDay + s.games.length * 2;

      // Only sim if today has reached that scheduled day
      if(todaySeasonDay < nextGameSeasonDay) return;

      const home = getTeamByName(s.home);
      const away = getTeamByName(s.away);
      const g = simPlayoffGame(home, away);

      // Stamp with the scheduled date, not today
      let rem = nextGameSeasonDay, gMonth = 0;
      while(gMonth < SEASON_MONTHS.length - 1 && rem >= SEASON_MONTHS[gMonth].days){
        rem -= SEASON_MONTHS[gMonth].days; gMonth++;
      }
      const gDay = rem + 1;

      s.games.push({ seasonDay: nextGameSeasonDay, month: gMonth, day: gDay, homeG: g.mg, awayG: g.og, homeWin: g.mg > g.og });
      if(g.result === 'W') s.homeW++;
      else s.awayW++;
      anySimmed = true;

      const isMy = s.home === myName || s.away === myName;
      if(isMy){
        const isHome = s.home === myName;
        const myWon = isHome ? g.result === 'W' : g.result === 'L';
        const myG = isHome ? g.mg : g.og;
        const oppG = isHome ? g.og : g.mg;
        const opp = isHome ? s.away : s.home;
        myResults.push({ result: myWon ? 'W' : 'L', myG, oppG, oppName: opp,
          monthName: SEASON_MONTHS[gMonth].name, day: gDay });
      }
      if(s.homeW === 4 || s.awayW === 4){
        s.winner = s.homeW > s.awayW ? s.home : s.away;
        s.done = true;
        state.log.push(`🏒 ${s.winner} wins the series!`);
      }
    });
    if(!anySimmed) break;
  }
  calCheckAdvanceRound();
  return myResults;
}

function applySeasonStartFloor(cal){
  cal.seasonStartFired = true;
  allTeams().forEach(team => clearFloorAdjustments(team));
  let myTeamWasBelow = false;
  let myTeamDeficit = 0;
  allTeams().forEach(team => {
    const below = isBelowFloor(team);
    console.log(`[Cap Floor] ${team.name} payroll: $${teamPayroll(team).toFixed(2)}M | floor: $${league.capFloor.toFixed(2)}M | below: ${below}`);
    if(below){
      if(team === state.myTeam){ myTeamWasBelow = true; myTeamDeficit = floorDeficit(team); }
      applyFloorAdjustment(team);
    }
  });
  const violations = validateSalaryFloors();
  if(violations > 0)
    state.log.push(`⚠️ ${violations} team(s) below cap floor — player salaries prorated upward to comply`);
  if(myTeamWasBelow)
    showFlash('Below Cap Floor!', `Your roster was $${myTeamDeficit.toFixed(1)}M short — all contracts prorated upward to hit the floor.`, 'loss');
  else
    console.log('[Cap Floor] Your team is above the floor — no adjustment needed.');
}

