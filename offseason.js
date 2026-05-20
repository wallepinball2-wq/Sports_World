// ================================================================
// PROSPECT & DRAFT SYSTEM — Role-Based Hidden Potential
// ================================================================

// True potential tiers by position group
// ----------------------------------------------------------------
// TALENT DISTRIBUTION — realistic hockey ecosystem
// Franchise = ~1 per league, Elite = ~10-15 league-wide
// Most players are middle-tier; superstars are memorable
// Goalies: heavily restricted — most teams have 1 true starter
// ----------------------------------------------------------------


// Draft class strength modifier — makes some years deeper or weaker
function draftClassStrength(){
  // Smaller modifiers — class quality shifts distribution but doesn't dominate
  const roll = rnd(1,100);
  if(roll <= 5)  return { label:'Exceptional', mod:1.12 };
  if(roll <= 20) return { label:'Strong',       mod:1.06 };
  if(roll <= 65) return { label:'Average',      mod:1.00 };
  if(roll <= 85) return { label:'Weak',         mod:0.94 };
  return              { label:'Very Weak',      mod:0.88 };
}

// Weighted random pick from tier list
function pickTier(tiers){
  const total = tiers.reduce((s,t)=>s+t.weight, 0);
  let r = Math.random() * total;
  for(const t of tiers){ r -= t.weight; if(r <= 0) return t; }
  return tiers[tiers.length-1];
}

// Get position group for tier lookup
// ----------------------------------------------------------------
// SCOUTING PROJECTION SYSTEM
// ----------------------------------------------------------------

// Franchise/Elite tiers get a special glow indicator
function tierIsElite(role){
  return role && (role.startsWith('Franchise') || role.startsWith('Elite'));
}

// Derive a scouting projection for ANY player based on OVR + age
// For draftees: use perceivedRole (scouting uncertainty already baked in)
// For veterans: derive from OVR — projection is fairly accurate but not perfect
// Is this prospect ready for meaningful NHL contribution?
// Based on age vs readinessAge from devVariance
function isNHLReady(p){
  if(!p.isDraftee) return true; // veterans are always "ready"
  if(!p.devVariance) return p.age >= 20;
  return p.age >= p.devVariance.readinessAge;
}

// Readiness label for UI
function readinessLabel(p){
  if(!p.isDraftee || !p.devVariance) return null;
  if(isNHLReady(p)) return null; // no label needed
  const yearsOut = p.devVariance.readinessAge - p.age;
  if(yearsOut <= 1) return { text:'Near Ready', color:'var(--gold)' };
  if(yearsOut <= 2) return { text:`${yearsOut}yr away`, color:'var(--text2)' };
  return { text:`Project (${yearsOut}yr)`, color:'#7f8c8d' };
}

function getProjection(p){
  // Draftees/young prospects: use scouting report
  if(p.perceivedRole) return p.perceivedRole;

  // Veterans: derive from current OVR (scouts have seen them play)
  const grp = posGroup(p.pos);
  const tiers = POTENTIAL_TIERS[grp];
  if(!tiers) return null;

  // Find the tier whose OVR range contains this player's OVR
  // Add small noise for younger players (more uncertainty)
  const uncertainty = p.age <= 23 ? rnd(-1, 1) : 0;
  const effectiveOVR = p.ovr + uncertainty;

  for(let i = 0; i < tiers.length; i++){
    const [lo, hi] = tiers[i].ovrRange;
    if(effectiveOVR >= lo - 1) return tiers[i].role;
  }
  return tiers[tiers.length-1].role;
}

// Render a compact projection badge
function projBadge(p){
  const role = getProjection(p);
  if(!role) return '';
  const color = TIER_COLORS[role] || 'var(--text2)';
  const isElite = tierIsElite(role);
  // Shorten label for table display
  const short = role
    .replace('Franchise ','F-')
    .replace('Elite ','E-')
    .replace('Top 6 ','T6 ')
    .replace('Top 9 ','T9 ')
    .replace('Top Pair ','TP ')
    .replace('Top 4 ','T4 ')
    .replace('Bottom 6 ','B6 ')
    .replace('Bottom Pair ','BP ')
    .replace('Depth ','D ')
    .replace('Starting ','ST ')
    .replace('Backup ','BU ')
    .replace('Forward','F')
    .replace('Defenseman','D')
    .replace('Goalie','G');
  return `<span title="${role}" style="
    font-size:10px;font-family:'Barlow Condensed',sans-serif;font-weight:700;
    padding:1px 6px;border-radius:3px;letter-spacing:0.3px;cursor:help;
    color:${color};
    background:${color}18;
    border:1px solid ${color}44;
    ${isElite?'box-shadow:0 0 6px '+color+'44;':''}
  ">${short}</span>`;
}

// ---- Potential Grade System (A-J based on ceiling OVR) ----
const POTENTIAL_GRADES = [
  { grade:'A', min:90 },
  { grade:'B', min:80 },
  { grade:'C', min:70 },
  { grade:'D', min:60 },
  { grade:'E', min:50 },
  { grade:'F', min:40 },
  { grade:'G', min:30 },
  { grade:'H', min:20 },
  { grade:'I', min:10 },
  { grade:'J', min:0  },
];

function potentialGrade(ceilOvr){
  for(const g of POTENTIAL_GRADES){ if(ceilOvr >= g.min) return g.grade; }
  return 'J';
}

// How many players a team ideally wants at each position
const IDEAL_POS = { C:4, LW:4, RW:4, LD:3, RD:3, G:2 };

// Returns a 0-1 need score per position (1 = critical need)
function teamPositionNeeds(team){
  if(!team || !team.roster) return {};
  const count = {};
  ['C','LW','RW','LD','RD','G'].forEach(p => count[p] = 0);
  team.roster.forEach(p => { count[p.pos] = (count[p.pos]||0) + 1; });
  const needs = {};
  ['C','LW','RW','LD','RD','G'].forEach(pos => {
    const ideal = IDEAL_POS[pos] || 3;
    const deficit = Math.max(0, ideal - (count[pos]||0));
    needs[pos] = Math.min(1, deficit / ideal);
  });
  return needs;
}

// Returns a scouting range string like "B-D" based on true grade + team need
// High need = tight range (+/-1 letter), low need = wide range (+/-3 letters)
function scoutingRange(prospect, team){
  const gradeLetters = POTENTIAL_GRADES.map(g => g.grade);
  const trueIdx = gradeLetters.indexOf(prospect.trueGrade);
  if(trueIdx === -1) return '?';

  const needs = teamPositionNeeds(team);
  const need = needs[prospect.pos] || 0;

  // More need = tighter scouting
  const spread = need >= 0.67 ? 1 : need >= 0.33 ? 2 : 3;
  const bias = rnd(-1, 1);
  const lo = Math.min(gradeLetters.length - 1, Math.max(0, trueIdx - spread + bias));
  const hi = Math.min(gradeLetters.length - 1, Math.max(0, trueIdx + spread + bias));

  const loGrade = gradeLetters[Math.min(lo, hi)];
  const hiGrade = gradeLetters[Math.max(lo, hi)];
  return loGrade === hiGrade ? loGrade : `${loGrade}-${hiGrade}`;
}

function posGroup(pos){
  if(pos === 'G') return 'G';
  if(pos === 'LD' || pos === 'RD') return 'D';
  return 'F';
}

// Scouting grade shown to user — intentionally imperfect
// True tier is hidden; scouting grade can be off by 1-2 tiers
function scoutingGrade(trueRoleIdx, posGrp, scoutingError){
  const tiers = POTENTIAL_TIERS[posGrp];
  // Error: positive = overrated, negative = underrated
  const perceivedIdx = Math.max(0, Math.min(tiers.length-1, trueRoleIdx + scoutingError));
  return tiers[perceivedIdx].role;
}

// Development variance — controls how a player actually develops
// Development timeline — controls readiness, pace, and failure odds
// readinessAge: earliest age player can meaningfully contribute at NHL level
// peakAge: when they hit their ceiling OVR
// rate: annual gain multiplier
// failChance: probability they never reach ceiling (bust)
function genDevVariance(pos, trueTierIdx){
  const roll = rnd(1,100);

  // Position modifiers: goalies + D develop slower
  const posDelay = (pos==='G') ? 2 : (pos==='LD'||pos==='RD') ? 1 : 0;

  // Tier modifiers: elite/franchise prospects take longer but arrive reliably
  // Depth prospects may be usable faster but ceiling is low
  const tierDelay = trueTierIdx <= 1 ? 1 : trueTierIdx >= 4 ? -1 : 0; // franchise delayed, depth faster

  let profile;
  if(roll <= 8){
    profile = { label:'Exceptional Talent', readinessAge:rnd(18,20), peakAge:rnd(20,23), rate:'fast',   failChance:0.05 };
  } else if(roll <= 20){
    profile = { label:'Fast Developer',     readinessAge:rnd(19,21), peakAge:rnd(22,24), rate:'fast',   failChance:0.10 };
  } else if(roll <= 55){
    profile = { label:'Normal Developer',   readinessAge:rnd(21,23), peakAge:rnd(24,27), rate:'normal', failChance:0.20 };
  } else if(roll <= 75){
    profile = { label:'Slow Developer',     readinessAge:rnd(22,25), peakAge:rnd(26,29), rate:'slow',   failChance:0.25 };
  } else if(roll <= 90){
    profile = { label:'Late Bloomer',       readinessAge:rnd(24,27), peakAge:rnd(27,31), rate:'slow',   failChance:0.30 };
  } else {
    profile = { label:'Project',            readinessAge:rnd(25,28), peakAge:rnd(28,32), rate:'slow',   failChance:0.45 };
  }

  // Apply position and tier delays
  profile.readinessAge = Math.min(27, profile.readinessAge + posDelay + tierDelay);
  profile.peakAge = Math.min(33, profile.peakAge + posDelay);

  // Roll bust now — if busted, ceiling is secretly reduced by 8-15 OVR
  profile.busted = Math.random() < profile.failChance;

  return profile;
}

// Round-based tier weight modifier — early rounds skew toward better tiers
function roundTierWeights(tiers, round, classMod){
  // Softened round bias: fewer elite prospects overall, late rounds feel appropriately weak
  return tiers.map((t, i)=>{
    const tierPos = tiers.length - 1 - i; // 0=depth, high=franchise
    // Earlier rounds: higher tierPos gets bigger bonus
    // Later rounds: lower tierPos (depth) gets bigger bonus
    const bias = tierPos * (2 - round * 0.35);
    const adjusted = Math.max(0.2, t.weight * (classMod || 1.0) + bias);
    return { ...t, weight: adjusted };
  });
}

function newProspect(round, classMod){
  // NHL draftees are exclusively 18 or 19
  const age = Math.random() < 0.50 ? 18 : 19;
  const pos = pick(POSITIONS);
  const grp = posGroup(pos);
  const tiers = POTENTIAL_TIERS[grp];

  // Pick true hidden potential tier (weighted by round)
  const weightedTiers = roundTierWeights(tiers, round, classMod || 1.0);
  const trueTierIdx = tiers.indexOf(tiers.find(t=>t===pickTier(weightedTiers)) ) ;
  const trueTier = tiers[Math.max(0, trueTierIdx)];

  // True ceiling OVR from tier range
  const [minOVR, maxOVR] = trueTier.ovrRange;
  const trueCeilOVR = rnd(minOVR, maxOVR);

  // Development variance — must come BEFORE rawness calculation
  const devVar = genDevVariance(pos, trueTierIdx);

  // Current OVR: rookies start well below ceiling
  // Most enter at 60-68; only exceptional fast developers touch 70+
  // rawness = how far below ceiling the rookie starts
  const rateRawness = { fast:rnd(18,24), normal:rnd(22,30), slow:rnd(26,34) };
  const baseRawness = rateRawness[devVar.rate] || rnd(22,30);
  const posRawness  = (pos==='G') ? rnd(8,14) : (pos==='LD'||pos==='RD') ? rnd(5,10) : 0;
  const totalRawness = baseRawness + posRawness;

  // If busted: apply hidden ceiling reduction now
  const effectiveCeil = devVar.busted
    ? Math.max(trueCeilOVR - rnd(8,15), POTENTIAL_TIERS[grp][tiers.length-1].ovrRange[0])
    : trueCeilOVR;

  // Hard cap starting OVR: max 73 for any rookie, typical range 58-68
  const rawStart = Math.min(effectiveCeil - totalRawness + rnd(-2,2), 73);
  const currentOVR = Math.max(56, rawStart);

  // Scouting uncertainty — how wrong scouts are about this player
  // Range: -2 (underrated gem) to +2 (overrated bust)
  const scoutingBias = rnd(-2, 2);
  // Lean toward slight overrating in early rounds (hype), underrating in late rounds (overlooked)
  const adjustedBias = Math.round(scoutingBias + (round <= 2 ? 0.5 : round >= 6 ? -0.5 : 0));
  const clampedBias = Math.max(-2, Math.min(2, adjustedBias));

  // What scouts report (visible to user, may differ from truth)
  const perceivedRoleIdx = Math.max(0, Math.min(tiers.length-1, trueTierIdx + clampedBias));
  const perceivedRole = tiers[perceivedRoleIdx].role;

  // Legacy potential grade (A/B/C) derived from true tier for compatibility
  const potential = trueTierIdx <= 1 ? 'A' : trueTierIdx <= 3 ? 'B' : 'C';

  // New A-J grade based on ceiling OVR (hidden until drafted)
  const trueGrade = potentialGrade(trueCeilOVR);

  // Generate attributes from current OVR
  const archetype = pickArchetype(pos);
  const attrs = genAttributes(pos, currentOVR, archetype);
  // Hard cap derived OVR — calcOVR can drift above currentOVR due to archetype bonuses
  const derivedOVR = Math.min(73, calcOVR(attrs, pos));

  return {
    id: Math.random().toString(36).slice(2,9),
    name: pname(), pos, ovr: derivedOVR, age,
    salary: 0, years: 0,
    isELC: false,  // Unsigned — ELC applied when formally signed in resign phase
    // Hidden truth
    trueTier: trueTier.role,
    trueCeilOVR,
    effectiveCeil,  // actual ceiling after bust check (hidden)
    devVariance: devVar,
    // Scouting report (visible — may be wrong)
    perceivedRole,
    scoutingBias: clampedBias, // hidden from user
    potential,       // legacy A/B/C for UI compatibility
    trueGrade,       // A-J based on ceiling OVR (hidden until drafted)
    gradeRevealed: false, // flips to true on draft
    potCeil: effectiveCeil, // uses effective (post-bust) ceiling for dev system
    // Flags
    isDraftee: true,
    archetype, attrs,
    stats: freshStats(pos),
    seasonHistory: [],
    careerTotals: freshCareerTotals(pos),
  };
}

function generateDraftClass(){
  const classStrength = draftClassStrength();
  state.draftClassStrength = classStrength;
  console.log(`[Draft] ${classStrength.label} draft class (modifier: ${classStrength.mod})`);

  const TOTAL_PROSPECTS = 425;
  const DRAFTED_SLOTS = 7 * 32; // 224 real picks

  const draftClass = [];

  // Real draft picks (rounds 1-7, 32 picks each)
  for(let r=1; r<=7; r++){
    for(let pk=1; pk<=32; pk++){
      draftClass.push({ round:r, pick:pk, prospect: newProspect(r, classStrength.mod) });
    }
  }

  // Extra undrafted prospects — generated at late-round quality (rounds 6-7)
  // These go straight to FA if not picked, which they won't be since they have no pick slot
  const extras = TOTAL_PROSPECTS - DRAFTED_SLOTS;
  for(let i=0; i<extras; i++){
    const simRound = rnd(6, 7); // late-round talent level
    draftClass.push({ round: null, pick: null, undrafted: true, prospect: newProspect(simRound, classStrength.mod) });
  }

  return draftClass;
}

function getDraftOrder(){
  // Reverse standings order (worst team picks first) — base slot order
  return allTeams().sort((a,b) => pts(a)-pts(b)).map(t=>t.name);
}

// Get the actual owner of a draft slot for a given round
// Checks pickInventory for trades — if a pick was traded, the new owner picks here
function getPickOwner(round, slotIdx){
  const season = state.season;
  // slotIdx is 0-based position in the draft order
  const originalTeam = state.draftOrder[slotIdx];
  if(!state.pickInventory) return originalTeam;
  // Find the pick in inventory matching this round, season, and original team
  const pick = state.pickInventory.find(p =>
    p.round === round &&
    p.season === season &&
    p.originalTeam === originalTeam
  );
  return pick ? pick.ownerTeam : originalTeam;
}

// Check if MY TEAM owns a pick at this slot
function isMyPickSlot(round, slotIdx){
  return getPickOwner(round, slotIdx) === state.myTeam.name;
}

// ---- AI Affiliate Management ----
// CPU teams send down any player below NHL calibre and backfill with better options.
// Called at the start of each offseason and right after the draft.
// OVR tier thresholds — edit here to change league-wide burial logic
const AFFILIATE_TIERS = {
  NHL_MIN:   76, // 76+ can stay on NHL roster (depth players, 4th line, 3rd pair)
  AHL_MIN:   68, // 68-75 → AHL affiliate
              // below AHL_MIN → ECHL
  AHL_MAX:   15, // max players on AHL roster
  ECHL_MAX:  10, // max players on ECHL roster
  TWO_WAY_MAX: 8, // max two-way contracts (players assignable to AHL/ECHL) across both affiliates
};

function trimAffiliateRosters(team, expiring){
  // No-op: affiliates are now purely developmental — no independent signing.
  // Players are only here if sent down from the NHL roster; they leave when their contract expires.
}

function aiManageAffiliates(){
  const { NHL_MIN, AHL_MIN } = AFFILIATE_TIERS;
  const ROSTER_MAX = 23;

  state.others.forEach(team => {
    if(!team.cpuAHL)  team.cpuAHL  = { roster: [] };
    if(!team.cpuECHL) team.cpuECHL = { roster: [] };

    const roster = team.roster;

    // --- Step 1: Send down players below NHL floor ---
    const toSendDown = roster.filter(p => p.ovr < NHL_MIN);
    toSendDown.forEach(p => {
      const idx = roster.indexOf(p);
      if(idx !== -1) roster.splice(idx, 1);
      if(p.ovr >= AHL_MIN){
        p._affiliate = 'cpuAHL';
        team.cpuAHL.roster.push(p);
      } else {
        p._affiliate = 'cpuECHL';
        team.cpuECHL.roster.push(p);
      }
    });

    // --- Step 2: Trim overflow — worst OVR goes down first ---
    while(roster.length > ROSTER_MAX){
      const worst = [...roster].sort((a,b) => a.ovr - b.ovr)[0];
      const idx = roster.indexOf(worst);
      roster.splice(idx, 1);
      if(worst.ovr >= AHL_MIN){
        worst._affiliate = 'cpuAHL';
        team.cpuAHL.roster.push(worst);
      } else {
        worst._affiliate = 'cpuECHL';
        team.cpuECHL.roster.push(worst);
      }
    }

    // --- Step 3: Backfill NHL roster gaps with replacement-level players ---
    // Target 21 (a realistic in-season NHL roster) not 18
    const needed = Math.max(0, Math.min(ROSTER_MAX, 21) - roster.length);
    for(let i = 0; i < needed; i++){
      // Bottom-6 forwards and bottom-pair D realistically range 76-82 OVR
      const callUp = newPlayer(null, rnd(76, NHL_MIN + 2));
      callUp.years = rnd(1, 2);
      roster.push(callUp);
    }
  });
}

function startOffseason(){
  // ================================================================
  // PROGRESSION & REGRESSION SYSTEM
  // Attribute-level changes with position-specific curves,
  // injury tracking, and visible decline indicators
  // ================================================================
  const devLog = [];

  // CPU teams manage their affiliate systems
  aiManageAffiliates();

  // Attribute regression curves by category
  // Each entry: [startAge, ratePerYear] — higher rate = faster decline
  const SKATER_DECAY = {
    // Physical attrs decline earliest and fastest
    speed:           [ [28,0.8], [31,1.5], [34,2.5], [37,3.5] ],
    acceleration:    [ [28,0.7], [31,1.4], [34,2.2], [37,3.0] ],
    agility:         [ [27,0.8], [30,1.5], [33,2.5], [36,3.5] ],
    endurance:       [ [30,0.6], [33,1.2], [36,2.0], [39,3.0] ],
    strength:        [ [32,0.5], [35,1.2], [38,2.0] ],
    checking:        [ [32,0.5], [35,1.0], [38,2.0] ],
    aggression:      [ [33,0.4], [36,1.0] ],
    // Technical attrs decline slower
    shootingAccuracy:[ [30,0.4], [33,0.8], [36,1.5], [39,2.5] ],
    shotPower:       [ [29,0.5], [32,1.0], [35,2.0], [38,3.0] ],
    passing:         [ [31,0.3], [34,0.7], [37,1.5] ],
    puckHandling:    [ [30,0.4], [33,0.8], [36,1.5] ],
    stickChecking:   [ [31,0.4], [34,0.8], [37,1.5] ],
    shotBlocking:    [ [32,0.3], [35,0.7], [38,1.5] ],
    // Mental attrs hold longest — hockey IQ actually peaks late
    offensiveIQ:     [ [33,0.2], [36,0.6], [39,1.5] ],
    defensiveIQ:     [ [34,0.2], [37,0.5], [40,1.2] ],
    vision:          [ [33,0.3], [36,0.7], [39,1.5] ],
    positioning:     [ [34,0.2], [37,0.5], [40,1.2] ],
    faceoffs:        [ [34,0.2], [37,0.5] ],
    poise:           [ [35,0.3], [38,0.8] ],
    balance:         [ [30,0.4], [33,0.8], [36,1.5] ],
    discipline:      [ [35,0.2], [38,0.5] ],
  };

  const GOALIE_DECAY = {
    reflexes:        [ [28,0.8], [31,1.5], [34,2.5], [37,3.5] ],
    agility:         [ [27,0.8], [30,1.5], [33,2.5], [36,3.5] ],
    recovery:        [ [29,0.7], [32,1.3], [35,2.2] ],
    endurance:       [ [31,0.5], [34,1.0], [37,2.0] ],
    positioning:     [ [33,0.2], [36,0.5], [39,1.2] ],
    angles:          [ [33,0.3], [36,0.6], [39,1.3] ],
    reboundControl:  [ [31,0.4], [34,0.8], [37,1.5] ],
    gloveStick:      [ [30,0.5], [33,0.9], [36,1.8] ],
    puckTracking:    [ [29,0.6], [32,1.2], [35,2.0] ],
    poise:           [ [35,0.2], [38,0.6] ],
    anticipation:    [ [33,0.3], [36,0.6], [39,1.2] ],
    consistency:     [ [32,0.4], [35,0.8], [38,1.5] ],
    strength:        [ [32,0.5], [35,1.2], [38,2.0] ],
    aggression:      [ [33,0.4], [36,1.0] ],
    durability:      [ [30,0.4], [33,0.8], [36,1.5] ],
  };

  // Get decay rate for an attribute at a given age
  function getDecayRate(curve, age){
    if(!curve) return 0;
    let rate = 0;
    for(const [startAge, r] of curve){
      if(age >= startAge) rate = r;
    }
    return rate;
  }

  // Injury chance increases with age
  function injuryChance(p){
    if(p.age < 28) return 0.04;
    if(p.age < 31) return 0.08;
    if(p.age < 34) return 0.14;
    if(p.age < 37) return 0.20;
    return 0.28;
  }

  // Build full list of rosters to age/develop: all NHL clubs + player affiliates + every CPU affiliate
  const cpuAffiliateRosters = (state.others || []).flatMap(t => [
    t.cpuAHL  ? { roster: t.cpuAHL.roster,  name: null, _cpuTeam: t } : null,
    t.cpuECHL ? { roster: t.cpuECHL.roster, name: null, _cpuTeam: t } : null,
  ]).filter(Boolean);

  [...allTeams(),
   { roster: state.ahl.roster,  name: null },
   { roster: state.echl.roster, name: null },
   ...cpuAffiliateRosters
  ].forEach(team=>{
    team.roster.forEach(p=>{
      p.age++;
      // Contract years (and ELC / extension rollover) only burn on NHL rosters — AHL/ECHL development does not eat NHL years in this sim.
      const nhlClub = team.name != null;
      if(nhlClub){
        p.years--;
        // Queued extension kicks in only when the current deal actually expires (years just hit 0).
        // Old bug: compared years to ext.years and never refreshed p.years, so players could hit FA with a pending extension or stay at 0 years.
        if(p.pendingExtension && p.years <= 0){
          const ext = p.pendingExtension;
          p.salary = ext.salary;
          p.capPct = ext.capPct;
          if(ext.clause){ p.clause = ext.clause; p.clauseYears = ext.clauseYears; if(ext.ntcList) p.ntcList = ext.ntcList; }
          else { p.clause = null; p.ntcList = null; p.clauseYears = 0; }
          p.pendingExtension = null;
          p.years = ext.years;
          p.isELC = false;
        } else if(p.isELC && p.years <= 0){
          p.elcJustExpired = true;
          p.isELC = false;
        }
      }

      const prevOVR = p.ovr;
      const isGoalie = p.pos === 'G';
      const decayTable = isGoalie ? GOALIE_DECAY : SKATER_DECAY;
      const attrKeys = isGoalie ? GOALIE_ATTR_KEYS : SKATER_ATTR_KEYS;
      const readyAge = p.devVariance?.readinessAge || 21;
      const peakAge  = p.devVariance?.peakAge || 26;
      const trueCeil = p.trueCeilOVR || p.potCeil || p.ovr;
      const devRate  = p.devVariance?.rate || 'normal';
      const inAffiliate = !nhlClub;

      // How many OVR points this player can gain in a single offseason.
      // Affiliate league = much slower; NHL = normal pace.
      // These are HARD maximums — no prospect should jump 5+ OVR in one year.
      const maxOvrGain = inAffiliate
        ? (devRate === 'fast' ? 2 : devRate === 'slow' ? 0 : 1)
        : (devRate === 'fast' ? 3 : devRate === 'slow' ? 1 : 2);

      if(!p.attrs){
        // Fallback for players without attribute objects
        if(p.age <= peakAge && p.ovr < trueCeil){
          const gain = inAffiliate ? (Math.random() < 0.4 ? 1 : 0) : rnd(0,1);
          p.ovr = Math.min(trueCeil, p.ovr + gain);
        } else if(p.age > 32){
          p.ovr = Math.max(60, p.ovr - rnd(0,1));
        }
      } else {
        // snapshot attrs before any changes so we can roll back excess gain
        const attrsBefore = {};
        attrKeys.forEach(k => { attrsBefore[k] = p.attrs[k] || 70; });

        attrKeys.forEach(k => {
          const val = attrsBefore[k];
          let delta = 0;

          if(p.age <= peakAge){
            // Attribute ceiling scales with trueCeil OVR:
            // A player with trueCeil=85 should have attributes averaging ~85.
            // We use trueCeil as a soft per-attribute cap too.
            const attrCeil = Math.min(99, trueCeil + 5); // attrs can slightly exceed OVR ceiling
            const headroom = Math.max(0, attrCeil - val);
            if(headroom <= 0){
              delta = 0; // already at or above ceiling for this attr
            } else if(p.age < readyAge){
              // Pre-readiness: very rare gains, small amounts
              // Affiliate makes it even rarer
              const chance = inAffiliate ? 0.08 : 0.15;
              delta = Math.random() < chance ? 1 : 0;
            } else {
              // Main development window
              // chance to gain anything at all this season
              // Assistant coach boosts development for the human team
              const coachDevMod = (nhlClub && nhlClub.name === state.myTeam.name) ? Math.max(0, devBonus() * 0.02) : 0;
              const gainChance = inAffiliate
                ? (devRate === 'fast' ? 0.20 : devRate === 'slow' ? 0.08 : 0.13)
                : (devRate === 'fast' ? 0.35 + coachDevMod : devRate === 'slow' ? 0.15 + coachDevMod : 0.25 + coachDevMod);
              if(Math.random() < gainChance){
                // Max 1 point per attribute per season — OVR cap enforced below
                delta = 1;
              }
            }
          } else {
            // Regression phase
            const rate = getDecayRate(decayTable[k], p.age);
            if(rate > 0){
              const roll = Math.random();
              if(roll < rate * 0.5)       delta = -Math.ceil(rate + rnd(0,1));
              else if(roll < rate * 0.8)  delta = -1;
              if(Math.random() < 0.15)    delta = 0;
            }
          }
          p.attrs[k] = Math.min(99, Math.max(40, val + delta));
        });

        // Sub-skill development — each sub develops independently,
        // then its parent skill is recalculated as the average of its subs.
        // This means sub-skill growth directly drives parent skill improvement.
        // Runs for both goalies (GOALIE_ATTR_SUBS) and skaters (SKATER_ATTR_SUBS).
        if(isGoalie){
          Object.entries(GOALIE_ATTR_SUBS).forEach(([skillKey, skillMeta]) => {
            skillMeta.subs.forEach(sub => {
              const subVal = p.attrs[sub.key] || 70;
              const subCeil = Math.min(99, trueCeil + 5);
              const subHeadroom = Math.max(0, subCeil - subVal);
              let subDelta = 0;
              if(p.age <= peakAge){
                if(subHeadroom <= 0){
                  subDelta = 0;
                } else if(p.age < readyAge){
                  subDelta = Math.random() < (inAffiliate ? 0.06 : 0.12) ? 1 : 0;
                } else {
                  const subGainChance = inAffiliate
                    ? (devRate === 'fast' ? 0.12 : devRate === 'slow' ? 0.05 : 0.08)
                    : (devRate === 'fast' ? 0.21 : devRate === 'slow' ? 0.09 : 0.15);
                  if(Math.random() < subGainChance) subDelta = 1;
                }
              } else {
                const rate = getDecayRate((GOALIE_DECAY || {})[skillKey] || 0, p.age);
                if(rate > 0){
                  const roll = Math.random();
                  if(roll < rate * 0.5)      subDelta = -Math.ceil(rate + rnd(0,1));
                  else if(roll < rate * 0.8) subDelta = -1;
                  if(Math.random() < 0.15)   subDelta = 0;
                }
              }
              p.attrs[sub.key] = Math.min(99, Math.max(40, subVal + subDelta));
            });
            // Bubble up: parent = blended average of subs
            const subAvg = Math.round(
              skillMeta.subs.reduce((s, sub) => s + (p.attrs[sub.key] || 70), 0) / skillMeta.subs.length
            );
            const blended = Math.round(subAvg * 0.7 + (p.attrs[skillKey] || 70) * 0.3);
            p.attrs[skillKey] = Math.min(99, Math.max(40, blended));
          });
        }
        if(!isGoalie){
          Object.entries(SKATER_ATTR_SUBS).forEach(([skillKey, skillMeta]) => {
            skillMeta.subs.forEach(sub => {
              const subVal = p.attrs[sub.key] || 70;
              const parentVal = p.attrs[skillKey] || 70;
              const subCeil = Math.min(99, trueCeil + 5);
              const subHeadroom = Math.max(0, subCeil - subVal);
              let subDelta = 0;

              if(p.age <= peakAge){
                if(subHeadroom <= 0){
                  subDelta = 0;
                } else if(p.age < readyAge){
                  subDelta = Math.random() < (inAffiliate ? 0.06 : 0.12) ? 1 : 0;
                } else {
                  // Sub-skills develop at ~60% the rate of parent skills — meaningful
                  // but parent still sets the pace
                  const subGainChance = inAffiliate
                    ? (devRate === 'fast' ? 0.12 : devRate === 'slow' ? 0.05 : 0.08)
                    : (devRate === 'fast' ? 0.21 : devRate === 'slow' ? 0.09 : 0.15);
                  if(Math.random() < subGainChance) subDelta = 1;
                }
              } else {
                // Regression: subs decay at same rate as their parent
                const rate = getDecayRate((SKATER_DECAY || {})[skillKey] || 0, p.age);
                if(rate > 0){
                  const roll = Math.random();
                  if(roll < rate * 0.5)      subDelta = -Math.ceil(rate + rnd(0,1));
                  else if(roll < rate * 0.8) subDelta = -1;
                  if(Math.random() < 0.15)   subDelta = 0;
                }
              }

              p.attrs[sub.key] = Math.min(99, Math.max(40, subVal + subDelta));
            });

            // Bubble up: parent skill = average of its sub-skills.
            // This is the key link — sub growth directly raises the parent.
            const subAvg = Math.round(
              skillMeta.subs.reduce((s, sub) => s + (p.attrs[sub.key] || 70), 0) / skillMeta.subs.length
            );
            // Only update parent if subs have pulled it meaningfully — don't let a single
            // lucky sub spike the parent, blend with existing parent value (70/30 split)
            const blended = Math.round(subAvg * 0.7 + (p.attrs[skillKey] || 70) * 0.3);
            p.attrs[skillKey] = Math.min(99, Math.max(40, blended));
          });
        }

        // Recalculate OVR from updated attributes
        p.ovr = isGoalie ? calcOVR(p.attrs, 'G') : calcOVR(p.attrs, p.pos);

        // Hard cap: if OVR gain this season exceeds maxOvrGain, roll attributes back
        // until OVR is within the allowed window. This is the real fix — not just
        // clamping p.ovr (which leaves attrs inflated for next season).
        if(p.ovr > prevOVR + maxOvrGain){
          // Roll back attribute gains one by one (in random order) until OVR is in range
          const order = [...attrKeys].sort(() => Math.random() - 0.5);
          for(const k of order){
            if(p.ovr <= prevOVR + maxOvrGain) break;
            if(p.attrs[k] > attrsBefore[k]){
              p.attrs[k] = attrsBefore[k]; // undo this attr's gain
              p.ovr = isGoalie ? calcOVR(p.attrs,'G') : calcOVR(p.attrs, p.pos);
            }
          }
          // Final safety clamp in case rollback left a rounding artifact
          p.ovr = Math.min(p.ovr, prevOVR + maxOvrGain);
        }

        // Also hard-cap OVR at trueCeil — prospects cannot exceed their ceiling
        if(p.ovr > trueCeil){
          p.ovr = trueCeil;
        }
      }

      // Injury tracking — older players risk missing time
      // Team doctor reduces injury risk for the human team's players
      const injFactor = (team && team.name === state.myTeam.name) ? injuryReductionFactor() : 1.0;
      const injRoll = Math.random();
      if(injRoll < injuryChance(p) * injFactor){
        const severity = injRoll < injuryChance(p) * 0.3 ? 'major' : 'minor';
        p.injuredLastSeason = severity;
        // Major injuries cause a permanent -1 to a random physical attr
        if(severity === 'major' && p.attrs){
          const physKeys = isGoalie
            ? ['reflexes','agility','recovery','endurance']
            : ['speed','acceleration','agility','endurance','strength'];
          const injured = pick(physKeys);
          p.attrs[injured] = Math.max(40, (p.attrs[injured]||70) - rnd(1,3));
          p.ovr = isGoalie ? calcOVR(p.attrs,'G') : calcOVR(p.attrs, p.pos);
          if(team.name) devLog.push(`🤕 ${p.name} (age ${p.age}) suffered a major injury — ${injured} affected`);
        } else if(team.name){
          devLog.push(`🩹 ${p.name} (age ${p.age}) had a minor injury last season`);
        }
      } else {
        p.injuredLastSeason = null;
      }

      // Decline indicator flag for UI
      p.inDecline = p.age >= 32 && p.ovr < prevOVR;
      p.decliningFast = p.age >= 35 && (prevOVR - p.ovr) >= 2;

      // Update salary
      if(p.ovr !== prevOVR){
        p.salary = Math.max(league.minSalary, salFromOVR(p.ovr));
        p.capPct = salaryToCapPct(p.salary);
        if(team.name && p.ovr > prevOVR)
          devLog.push(`📈 ${p.name} (${p.age}) improved ${prevOVR}→${p.ovr} OVR`);
        else if(team.name && p.ovr < prevOVR)
          devLog.push(`📉 ${p.name} (${p.age}) regressed ${prevOVR}→${p.ovr} OVR`);
      }
    });
  });
  devLog.slice(0,15).forEach(e=>state.log.push(e));

  // ── RETIREMENT SYSTEM ────────────────────────────────────────────
  // Probability-based: older/worse players have a higher chance each offseason.
  function retireChance(p){
    if(p.age < 34) return 0;
    if(p.age >= 42) return 1.00;
    if(p.age >= 40) return 0.85;
    if(p.age >= 38) return p.ovr < 70 ? 0.70 : 0.40;
    if(p.age >= 36) return p.ovr < 68 ? 0.45 : 0.18;
    if(p.age >= 34) return p.ovr < 65 ? 0.30 : 0.08;
    return 0;
  }
  function retirementSummary(p){
    const ct = p.careerTotals || {};
    const seasons = (p.seasonHistory || []).length;
    if(p.pos === 'G') return seasons + ' seasons · ' + (ct.w||0) + 'W ' + (ct.l||0) + 'L';
    const pts = (ct.g||0) + (ct.a||0);
    return seasons + ' seasons · ' + (ct.g||0) + 'G ' + (ct.a||0) + 'A ' + pts + 'PTS';
  }
  if(!state.retirements) state.retirements = [];
  state.retirements = [];
  allTeams().forEach(team => {
    const isMyTeam = team.name === state.myTeam.name;
    const staying = [];
    team.roster.forEach(p => {
      const chance = retireChance(p);
      if(chance > 0 && Math.random() < chance){
        const summary = retirementSummary(p);
        state.retirements.push({ name: p.name, age: p.age, pos: p.pos, ovr: p.ovr, team: team.name, summary, myTeam: isMyTeam });
        state.log.push('🏁 ' + p.name + ' (age ' + p.age + ') has retired. ' + summary);
      } else {
        staying.push(p);
      }
    });
    team.roster = staying;
  });

  // Tick down retained salary obligations — remove when years run out
  if(state.myTeam.retainedContracts && state.myTeam.retainedContracts.length){
    state.myTeam.retainedContracts = state.myTeam.retainedContracts
      .map(r => ({ ...r, years: r.years - 1 }))
      .filter(r => {
        if(r.years <= 0){
          state.log.push(`✅ Retained salary on ${r.name} ($${r.amt.toFixed(2)}M/yr) has expired.`);
          return false;
        }
        return true;
      });
  }

  // Collect expiring contracts (years <= 0) from all teams into FA pool
  // CPU teams get a chance to re-sign their own expiring players first
  const expiring = [];
  allTeams().forEach(team=>{
    const kept = [], released = [];
    team.roster.forEach(p=>{
      // Unsigned draftees (isDraftedByMe) are handled separately — check rights expiry
      if(p.isDraftedByMe){
        const rightsExpired = (state.season || 1) > (p.draftRightsExpiry || 0);
        if(rightsExpired){
          // Rights lapsed — player walks, no longer obligated to sign here
          state.log.push(`📋 Draft rights to ${p.name} have expired — player is now a free agent.`);
          released.push(p);
          p.isDraftedByMe = false;
        } else {
          kept.push(p); // still unsigned but rights retained — shows in resign phase again
        }
      } else if(p.years<=0){
        released.push(p);
      } else {
        kept.push(p);
      }
    });
    team.roster = kept;
    released.forEach(p=>{
      if(team.name===state.myTeam.name){
        p._myTeam=true;
        expiring.push(p);
      } else {
        // CPU teams re-sign ~70% of their own expiring NHL-calibre players if cap allows.
        // Players below NHL_MIN are let walk — they'll be buried in affiliates if re-signed anyway.
        const { NHL_MIN: _NHL_MIN, AHL_MIN: _AHL_MIN } = AFFILIATE_TIERS;
        const capRoom = BUDGET - team.roster.reduce((s,x)=>s+x.salary,0);
        const wantsToResign = Math.random() < 0.70 && p.ovr >= _NHL_MIN && p.salary <= capRoom;
        if(wantsToResign){
          p.years = contractYears(p.ovr, p.age);
          team.roster.push(p);
        } else {
          expiring.push(p); // goes to FA — no affiliate re-signing
        }
      }
    });
  });
  // Same offseason pipeline for AHL/ECHL: expired deals (including finished ELCs) go to your re-sign list / FA
  [state.ahl, state.echl].forEach(aff=>{
    if(!aff || !aff.roster) return;
    const kept = [], released = [];
    aff.roster.forEach(p=>{
      const yrs = (p.years == null ? 0 : p.years);
      if(yrs <= 0){ released.push(p); }
      else kept.push(p);
    });
    aff.roster = kept;
    released.forEach(p=>{
      if(p.years < 0) p.years = 0;
      p._myTeam = true;
      expiring.push(p);
    });
  });
  // ── CPU affiliate pipeline: expire contracts, re-tier on development, bubble expired up to NHL re-sign ──
  const { NHL_MIN: CPUNHL, AHL_MIN: CPUAHL } = AFFILIATE_TIERS;
  (state.others || []).forEach(team => {
    if(!team.cpuAHL)  team.cpuAHL  = { roster: [] };
    if(!team.cpuECHL) team.cpuECHL = { roster: [] };

    // Expire contracts — bring player back up to the NHL level to be re-signed there,
    // rather than having the affiliate re-sign them directly.
    [
      { pool: team.cpuAHL.roster,  tag: 'cpuAHL'  },
      { pool: team.cpuECHL.roster, tag: 'cpuECHL' },
    ].forEach(({ pool, tag }) => {
      const kept = [], released = [];
      pool.forEach(p => {
        if((p.years == null ? 0 : p.years) <= 0) released.push(p);
        else kept.push(p);
      });
      if(tag === 'cpuAHL') team.cpuAHL.roster = kept;
      else                 team.cpuECHL.roster = kept;
      released.forEach(p => {
        p._affiliate = null;
        if(p._myTeam){
          // Player's team is the user — surface on the re-sign screen
          expiring.push(p);
        } else {
          // CPU team: re-sign at NHL level if good enough and cap allows, else FA
          const { NHL_MIN: _NHL_MIN } = AFFILIATE_TIERS;
          const BUDGET = league.salaryCap * 0.95;
          const capRoom = BUDGET - team.roster.reduce((s,x) => s + x.salary, 0);
          if(p.ovr >= _NHL_MIN && Math.random() < 0.65 && p.salary <= capRoom){
            p.years = contractYears(p.ovr, p.age);
            team.roster.push(p);
          } else {
            expiring.push(p); // to FA
          }
        }
      });
    });

    // Re-tier anyone who has developed or regressed since last offseason
    [...team.cpuAHL.roster].forEach(p => {
      if(p.ovr >= CPUNHL){
        team.cpuAHL.roster = team.cpuAHL.roster.filter(x => x.id !== p.id);
        p._affiliate = null;
        team.roster.push(p);
      } else if(p.ovr < CPUAHL){
        team.cpuAHL.roster = team.cpuAHL.roster.filter(x => x.id !== p.id);
        p._affiliate = 'cpuECHL';
        team.cpuECHL.roster.push(p);
      }
    });
    [...team.cpuECHL.roster].forEach(p => {
      if(p.ovr >= CPUAHL){
        team.cpuECHL.roster = team.cpuECHL.roster.filter(x => x.id !== p.id);
        p._affiliate = 'cpuAHL';
        team.cpuAHL.roster.push(p);
      }
    });

    // Trim NHL overflow after promotions — worst OVR gets re-buried in affiliates
    while(team.roster.length > 23){
      const worst = [...team.roster].sort((a,b) => a.ovr - b.ovr)[0];
      team.roster = team.roster.filter(x => x.id !== worst.id);
      if(worst.ovr >= CPUAHL){
        worst._affiliate = 'cpuAHL';
        team.cpuAHL.roster.push(worst);
      } else {
        worst._affiliate = 'cpuECHL';
        team.cpuECHL.roster.push(worst);
      }
    }
  });

  state.fa = [...expiring];
  state.myExpiring = expiring.filter(p => p._myTeam);

  // Generate draft class
  state.draftClass = generateDraftClass();
  state.draftOrder = getDraftOrder();
  state.draftRound = 1;
  state.draftPick = 1; // 1-indexed position in draftOrder
  state.offseasonPhase = 'draft'; // draft -> resign -> fa -> done

  // Show offseason-only nav buttons
  document.querySelectorAll('.sidebar-btn.offseason-only').forEach(b=>b.classList.add('visible'));
  renderAll();
  if(state.retirements && state.retirements.length > 0){
    showRetirements();
  } else {
    showTab('draft');
    showFlash('Offseason!', 'Start with the Entry Draft.', 'otl');
  }
}

function renderResign(){ if(!gameStarted) return;
  const el = document.getElementById('resign-body');
  // Repair: any NHL roster player with 0 (or fewer) years left should be in the FA pool for this phase
  // BUT exclude unsigned draftees (isDraftedByMe) — they're handled separately below
  const stuck = (state.myTeam.roster || []).filter(p => (p.years == null ? 0 : p.years) <= 0 && !p.isDraftedByMe);
  stuck.forEach(p => {
    p._myTeam = true;
    p.isELC = false;
    if(!state.fa) state.fa = [];
    state.fa.push(p);
  });
  if(stuck.length){
    state.myTeam.roster = state.myTeam.roster.filter(p => (p.years == null ? 0 : p.years) > 0);
    state.log.push(`📋 ${stuck.length} player(s) with expired contracts moved to your re-sign list.`);
  }

  const myFA = state.fa.filter(p => p._myTeam);
  const finalYear = (state.myTeam.roster || []).filter(p => p.years === 1 && !p.isDraftedByMe);
  // Unsigned draftees: on roster but no ELC yet (drafted this offseason)
  const unsignedDraftees = (state.myTeam.roster || []).filter(p => p.isDraftedByMe);
  let html = `<div class="offseason-banner"><h2>Re-Sign Your Players</h2><p>Everyone whose ${LEAGUE_NAMES.pro} contract just expired (including ELCs ending this year) appears below. Final-year players on your roster are listed so you can extend before next season.</p></div>`;

  // ── Unsigned Draftees (ELC signing) ──────────────────────────────────────
  if(unsignedDraftees.length > 0){
    html += `<div style="margin-bottom:24px;border:1px solid rgba(243,156,18,0.3);border-radius:8px;padding:14px 16px;background:rgba(243,156,18,0.04);">
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">⭐ Sign Your Draft Picks (ELC)</div>
      <p style="font-size:12px;color:var(--text2);margin-bottom:10px;">These players were drafted by you but have not yet signed an Entry Level Contract. Sign them to lock them in — unsigned picks will be released at the end of the re-sign period.</p>
      <table width="100%" style="border-collapse:collapse;font-size:13px;">
        <thead><tr>
          <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Player</th>
          <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Pos</th>
          <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Age</th>
          <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">OVR</th>
          <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Grade</th>
          <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Round</th>
          <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Rights</th>
          <th style="padding:6px 8px;border-bottom:1px solid var(--border);"></th>
        </tr></thead><tbody>`;
    unsignedDraftees.forEach(p => {
      const dr = p.draftInfo ? `Rnd ${p.draftInfo.round}, Pick ${p.draftInfo.pick}` : 'Undrafted';
      const rightsLeft = (p.draftRightsExpiry || 0) - (state.season || 1);
      const rightsLabel = rightsLeft <= 0
        ? `<span style="color:var(--red2);font-weight:700;">Rights expiring!</span>`
        : rightsLeft === 1
          ? `<span style="color:var(--gold);font-weight:700;">Last chance (1 yr)</span>`
          : `<span style="color:var(--text2);">${rightsLeft} yrs left</span>`;
      html += `<tr>
        <td style="padding:8px;font-weight:500;">${p.name}</td>
        <td style="padding:8px;"><span class="pos-badge">${p.pos}</span></td>
        <td style="padding:8px;">${p.age}</td>
        <td style="padding:8px;">${ovrCell(p.ovr)}</td>
        <td style="padding:8px;"><span style="font-family:'Barlow Condensed';font-weight:700;color:var(--gold);font-size:15px;">${p.trueGrade || '?'}</span></td>
        <td style="padding:8px;font-size:12px;color:var(--text2);">${dr}</td>
        <td style="padding:8px;font-size:12px;">${rightsLabel}</td>
        <td style="padding:8px;">
          <button class="btn btn-sm btn-gold" onclick="openSign('${p.id}')">Offer ELC</button>
          <button class="btn btn-sm" style="margin-left:4px;" onclick="releaseDraftee('${p.id}')">Release</button>
        </td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  }
  if(myFA.length===0){
    html += `<p style="color:var(--text2);font-size:13px;margin-bottom:16px;">No contracts expired this offseason — none of your players were released to your re-sign list.</p>`;
  } else {
    html += `<div style="margin-bottom:20px;"><div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Expired contracts — your rights (re-sign or let walk)</div>`;
    html += `<table width="100%" style="border-collapse:collapse;font-size:13px;">
      <thead><tr>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Player</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Pos</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Age</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">OVR</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Type</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Ask</th>
        <th style="padding:6px 8px;border-bottom:1px solid var(--border);"></th>
      </tr></thead><tbody>`;
    myFA.forEach(p=>{
      const tag = p.elcJustExpired ? '<span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;background:rgba(243,156,18,0.15);color:var(--gold);border:1px solid rgba(243,156,18,0.3);">ELC ended</span>' : 'UFA / RFA';
      html += `<tr>
        <td style="padding:8px;">${p.name}</td>
        <td style="padding:8px;"><span class="pos-badge">${p.pos}</span></td>
        <td style="padding:8px;">${p.age}</td>
        <td style="padding:8px;">${ovrCell(p.ovr)}</td>
        <td style="padding:8px;">${tag}</td>
        <td style="padding:8px;">$${(playerAsk(p).salary).toFixed(2)}M/yr</td>
        <td style="padding:8px;"><button class="btn btn-sm btn-gold" onclick="openSign('${p.id}')">Re-Sign</button>
        <button class="btn btn-sm" style="margin-left:4px;" onclick="releaseToFA('${p.id}')">Let Go</button></td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  }
  if(finalYear.length){
    html += `<div style="margin-bottom:20px;margin-top:8px;"><div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Still under contract — final season (${finalYear.length})</div>
    <p style="font-size:12px;color:var(--text2);margin-bottom:10px;">These players have one year remaining on their ${LEAGUE_NAMES.pro} deal. Use Extend to negotiate now, or they will roll to this list next offseason when the contract expires.</p>
    <table width="100%" style="border-collapse:collapse;font-size:13px;">
      <thead><tr>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Player</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Pos</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Yrs left</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Salary</th>
        <th style="padding:6px 8px;border-bottom:1px solid var(--border);"></th>
      </tr></thead><tbody>`;
    finalYear.forEach(p=>{
      const elc = p.isELC ? ' <span style="font-size:10px;color:var(--gold);">ELC</span>' : '';
      html += `<tr>
        <td style="padding:8px;">${p.name}${elc}</td>
        <td style="padding:8px;"><span class="pos-badge">${p.pos}</span></td>
        <td style="padding:8px;">1</td>
        <td style="padding:8px;">$${p.salary.toFixed(2)}M</td>
        <td style="padding:8px;"><button class="btn btn-sm btn-gold" onclick="openExtend('${p.id}')">Extend</button></td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  }
  html += `<div style="margin-top:16px;"><button class="btn btn-red" onclick="goToFreeAgency()">Go to Free Agency →</button></div>`;
  el.innerHTML = html;
}

function releaseToFA(id){
  // Already in FA, just remove _myTeam flag
  const p = state.fa.find(x=>x.id===id);
  if(p) p._myTeam = false;
  renderResign();
}

function releaseDraftee(id){
  // Remove unsigned draftee from roster entirely — they become free agents (or just removed)
  const idx = state.myTeam.roster.findIndex(p => p.id === id);
  if(idx === -1) return;
  const [p] = state.myTeam.roster.splice(idx, 1);
  p.isDraftedByMe = false;
  state.log.push(`📋 ${p.name} released — did not sign an ELC.`);
  renderResign();
}

function goToResign(){
  state.offseasonPhase = 'resign';
  showTab('resign');
  renderResign();
}

function goToDraft(){
  state.offseasonPhase = 'draft';
  showTab('draft');
  renderDraft();
}

function renderDraft(){ if(!gameStarted) return;
  const el = document.getElementById('draft-body');
  
  // Initialize draft state if it doesn't exist
  if(!state.draftClass){
    state.draftClass = generateDraftClass();
    state.draftOrder = getDraftOrder();
    state.draftRound = 1;
    state.draftPick = 1;
    state.draftLog = [];
    state.offseasonPhase = 'draft';
  }
  
  if(!state.draftClass){ el.innerHTML='<p style="color:var(--text2)">Draft not available yet.</p>'; return; }

  const round = state.draftRound;
  const pickNum = state.draftPick;
  const isMyPick = isMyPickSlot(round, (pickNum-1) % 32);
  const draftIdx = (round-1)*32 + (pickNum-1);
  const currentPick = state.draftClass[draftIdx];

  if(round > 7){
    // Draft over — send all undrafted prospects to free agency (only once)
    const undrafted = state.draftClass.filter(dp => !dp.drafted);
    if(undrafted.length > 0){
      if(!state.fa) state.fa = [];
      undrafted.forEach(dp => {
        dp.drafted = true;
        const p = dp.prospect;
        p.years = 1;
        p.salary = p.salary || 0.75;
        state.fa.push(p);
      });
      state.undraftedFACount = undrafted.length;
      console.log(`[Draft] ${undrafted.length} undrafted prospects added to free agency`);
    }
    const count = state.undraftedFACount || 0;
    let html = `<div class="offseason-banner"><h2>Draft Complete!</h2><p>${count} undrafted prospects have entered free agency.</p></div>`;
    html += `<button class="btn btn-red" onclick="goToResign()">Go to Re-Signing →</button>`;
    el.innerHTML = html;
    return;
  }

  let html = `<div class="offseason-banner"><h2>${LEAGUE_NAMES.pro} Entry Draft</h2><p>Round ${round}, Pick ${pickNum} of 32 · ${isMyPick?'<strong style="color:var(--gold)">YOUR PICK</strong>':'Simming other picks...'}</p></div>`;

  if(isMyPick && currentPick){
    // Show ALL remaining undrafted prospects in this round and beyond
    const remaining = state.draftClass.filter(dp => !dp.drafted && !dp.undrafted);
    // Sort prospects
    const DEV_ORDER = ['Exceptional Talent','Fast Developer','Normal Developer','Slow Developer','Late Bloomer','Project'];
    const POS_ORDER = ['C','LW','RW','LD','RD','G'];
    const sortedRemaining = [...remaining].sort((a,b)=>{
      const pa=a.prospect, pb=b.prospect;
      const { key, dir } = draftSort;
      if(key==='pos') return (POS_ORDER.indexOf(pa.pos)-POS_ORDER.indexOf(pb.pos))*dir;
      if(key==='age') return (pa.age-pb.age)*dir;
      if(key==='ovr') return (pa.ovr-pb.ovr)*dir;
      if(key==='dev') return (DEV_ORDER.indexOf(pa.devVariance?.label)-DEV_ORDER.indexOf(pb.devVariance?.label))*dir;
      return 0;
    });

    const thStyle = (k) => `text-align:left;padding:6px 8px;font-size:12px;border-bottom:1px solid var(--border);cursor:pointer;user-select:none;color:${draftSort.key===k?'var(--ice)':'var(--text2)'};`;
    const arrow = (k) => draftSort.key===k ? (draftSort.dir===1?' ↑':' ↓') : '';

    // Paginate prospects
    const draftTotalPages = Math.max(1, Math.ceil(sortedRemaining.length / DRAFT_PAGE_SIZE));
    if(draftPage >= draftTotalPages) draftPage = draftTotalPages - 1;
    if(draftPage < 0) draftPage = 0;
    const draftPageStart = draftPage * DRAFT_PAGE_SIZE;
    const draftPageEnd   = Math.min(draftPageStart + DRAFT_PAGE_SIZE, sortedRemaining.length);
    const pageProspects  = sortedRemaining.slice(draftPageStart, draftPageEnd);

    html += `<div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Available Prospects (${remaining.length} remaining)</div>`;
    html += `<table width="100%" style="border-collapse:collapse;font-size:13px;margin-bottom:12px;">
      <thead><tr>
        <th style="${thStyle('name')}">Name</th>
        <th onclick="sortDraft('pos')" style="${thStyle('pos')}">Pos${arrow('pos')}</th>
        <th onclick="sortDraft('age')" style="${thStyle('age')}">Age${arrow('age')}</th>
        <th onclick="sortDraft('ovr')" style="${thStyle('ovr')}">OVR${arrow('ovr')}</th>
        <th style="${thStyle('scout')}">Scout Report</th>
        <th onclick="sortDraft('dev')" style="${thStyle('dev')}">Dev Type${arrow('dev')}</th>
        <th style="${thStyle('grade')}">Pot. Range</th>
        <th style="padding:6px 8px;border-bottom:1px solid var(--border);"></th>
      </tr></thead><tbody>`;
    pageProspects.forEach((dp)=>{
      const pr = dp.prospect;
      const idx = state.draftClass.indexOf(dp);
      html += `<tr>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);font-weight:500;">${pr.name}</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);"><span class="pos-badge">${pr.pos}</span></td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">${pr.age}</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">${ovrCell(pr.ovr)}</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">${projBadge(pr)}</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">${(()=>{ const dv=pr.devVariance; return dv?`<span style="font-size:11px;color:var(--text2);">${dv.label}</span>`:''; })()}</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--gold);">${scoutingRange(pr, state.myTeam)}</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);"><button class="btn btn-sm btn-gold" onclick="selectDraftPick('${pr.id}',${idx})">Draft</button></td>
      </tr>`;
    });
    html += `</tbody></table>`;
    html += `<div style="display:flex;align-items:center;justify-content:center;gap:14px;padding:10px 0 20px;font-size:13px;">
      <button class="btn btn-sm" onclick="draftPageNav(-1)" ${draftPage===0?'disabled':''}>◀ Prev</button>
      <span style="color:var(--text2);">Page <strong style="color:#fff;">${draftPage+1}</strong> of <strong style="color:#fff;">${draftTotalPages}</strong> &nbsp;·&nbsp; ${sortedRemaining.length} prospects</span>
      <button class="btn btn-sm" onclick="draftPageNav(1)" ${draftPage>=draftTotalPages-1?'disabled':''}>Next ▶</button>
    </div>`;
  } else if(currentPick){
    // Auto-sim CPU pick
    html += `<div style="margin-bottom:16px;font-size:14px;color:var(--text2);">CPU teams are picking...</div>`;
    html += `<button class="btn btn-gold" onclick="simCPUPick()">Sim Next Pick →</button>
             <button class="btn" style="margin-left:8px;" onclick="simToMyPick()">Sim To My Pick →</button>`;
  }

  // Recent picks log
  if(state.draftLog && state.draftLog.length){
    html += `<div style="margin-top:20px;"><div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Recent Picks</div>`;
    html += `<div class="log-area" style="max-height:180px;">`;
    [...state.draftLog].reverse().slice(0,20).forEach(e=>{ html+=`<div class="log-line">${e}</div>`; });
    html += `</div></div>`;
  }

  el.innerHTML = html;
}

function selectDraftPick(prospectId, classIdx){
  try {
    if(!state || !state.draftClass) {
      console.error('Draft state not initialized');
      return;
    }
    const dp = state.draftClass[classIdx];
    if(!dp) {
      console.error('Draft pick not found at index:', classIdx);
      return;
    }
    if(dp.drafted) {
      console.error('Prospect already drafted');
      return;
    }
    const p = dp.prospect;
    p.isELC = false;       // No ELC yet — must be signed in resign phase
    p.years = 0;           // Unsigned
    p.salary = 0;
    p.capPct = 0;
    p.gradeRevealed = true; // reveal true grade on draft
    p.draftRightsExpiry = (state.season || 1) + 4; // team holds rights for 4 more offseasons after draft year
    p.isDraftedByMe = true;  // Flag: user drafted this player, ELC pending
    // Store draft info permanently on player
    p.draftInfo = { round: state.draftRound, pick: state.draftPick, team: state.myTeam.name, season: state.season };
    state.myTeam.roster.push(p);
    state.log.push(`📋 ${p.name} drafted — sign to ELC during re-sign phase. Rights held through ${(state.season||1)+4} offseason.`);
    dp.drafted = true;
    state.draftLog = state.draftLog||[];
    state.draftLog.push(`<span style="color:var(--gold)">⭐ Rnd ${state.draftRound} Pick ${state.draftPick}: ${state.myTeam.name} select ${p.name} (${p.pos}, OVR ${p.ovr}) — Grade: <strong>${p.trueGrade}</strong></span>`);
    // Keep roster tab up to date after each pick
    renderRoster();
    renderAll();
    advanceDraftPick();
  } catch(error) {
    console.error('Error in selectDraftPick:', error);
  }
}

function simCPUPick(){
  try {
    if(!state || !state.draftClass) {
      console.error('Draft state not initialized for CPU pick');
      return;
    }
    const round = state.draftRound;
    const pickNum = state.draftPick;
    const teamName = getPickOwner(round, (pickNum-1) % 32);
    const team = getTeamByName(teamName);

    // Pick best available undrafted prospect by OVR (exclude no-slot extras)
    // Small positional need bias: if team has a glaring hole, prefer that position
    const available = state.draftClass.filter(dp => !dp.drafted && !dp.undrafted);
    if(!available.length || !team){ advanceDraftPick(); return; }

  // Score each available prospect using true grade + positional need
  const gradeLetters = POTENTIAL_GRADES.map(g => g.grade);
  const needs = teamPositionNeeds(team);
  const scored = available.map(dp => {
    const p = dp.prospect;
    const gradeIdx = gradeLetters.indexOf(p.trueGrade || 'J');
    const gradeScore = (gradeLetters.length - 1 - gradeIdx) * 10; // A=90, B=80 ... J=0
    const need = needs[p.pos] || 0;
    const needBonus = need * 15; // up to +15 for critical need position
    return { dp, score: gradeScore + needBonus + rnd(-4, 4) };
  });
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0].dp;
  best.drafted = true;
  const p = best.prospect;
  p.isELC = true;
  p.years = ELC.maxYears;
  p.salary = ELC.maxSalary;
  p.capPct = salaryToCapPct(p.salary);
  p.draftInfo = { round, pick: pickNum, team: teamName, season: state.season };
  team.roster.push(p);
  state.draftLog = state.draftLog || [];
  state.draftLog.push(`Rnd ${round} Pick ${pickNum}: ${teamName} select ${p.name} (${p.pos}, OVR ${p.ovr})`);

  advanceDraftPick();
  } catch(error) {
    console.error('Error in simCPUPick:', error);
  }
}

function simToMyPick(){
  let safety = 0;
  while(safety++ < 250){
    const round = state.draftRound;
    const pickNum = state.draftPick;
    if(round > 7) break;
    const teamName = getPickOwner(round, (pickNum-1) % 32);
    if(teamName === state.myTeam.name) break;
    simCPUPick();
  }
  renderDraft();
}

function advanceDraftPick(){
  state.draftPick++;
  if(state.draftPick > 32){
    state.draftPick = 1;
    state.draftRound++;
  }
  renderDraft();
  // Keep cap/ovr header stats current as picks come in
  renderAll();
}

function goToFreeAgency(){
  state.offseasonPhase = 'fa';
  // Advance calendar to July 1 (FA opening day) if not already there
  const cal = state.calendar;
  const faMonth = SEASON_MONTHS.findIndex(m => m.name === PHASE_DATES.freeAgencyStart.month);
  const faDay = PHASE_DATES.freeAgencyStart.day;
  const todaySeasonDay = SEASON_MONTHS.slice(0, cal.currentMonth).reduce((s,m)=>s+m.days,0) + cal.currentDay - 1;
  const faSeasonDay = SEASON_MONTHS.slice(0, faMonth).reduce((s,m)=>s+m.days,0) + faDay - 1;
  if(todaySeasonDay < faSeasonDay){
    cal.currentMonth = faMonth;
    cal.currentDay = faDay;
    cal.viewMonth = faMonth;
    cal.viewYear = faMonth >= 3 ? cal.year + 1 : cal.year;
  }
  // Clean up any sub-NHL players that slipped through the draft onto CPU rosters
  aiManageAffiliates();
  // Expiring players are already in state.fa from startOffseason; remove exclusive rights if they did not re-sign
  if(state.myExpiring){
    state.myExpiring.forEach(p=>{
      if(!p._resigned && !p._letGo){
        p._letGo = true;
        p._myTeam = false;
        state.log.push(`🚪 ${p.name} is now available to all teams in free agency`);
        console.log(`[Player] ${p.name} entered league-wide free agency`);
      }
    });
  }

  showTab('fa');
  renderFA();
  // CPU teams immediately make their day-1 offers (resolve when you sim a day)
  cpuMakeOffers();
  showFlash('Free Agency', 'Sign the players you need!', 'otl');
}

function resolvePendingOffers(){
  if(!state.faPendingOffers || !state.faPendingOffers.length) return;
  const resolved = [];
  const notifications = [];

  state.faPendingOffers.forEach(offer => {
    // Find player — still in state.fa (not pulled out anymore)
    const p = state.fa.find(x => x.id === offer.id);
    if(!p){
      // Player was already signed by a CPU team (resolveCpuOffers ran first)
      resolved.push(offer.id);
      return;
    }

    const { accepts } = contractAcceptance(p, offer.sal, offer.yrs, offer.isTwoWay || false);
    if(accepts){
      p.years = offer.yrs;
      p.salary = offer.sal;
      p.capPct = salaryToCapPct(offer.sal);
      p.isELC = offer.isELC;
      p.isTwoWay = offer.isTwoWay || false;
      p.minorSalary = offer.minorSalary || null;
      p.nhlSalary = offer.sal;
      delete p.elcJustExpired;
      // Remove from FA now that signed
      state.fa = state.fa.filter(x => x.id !== p.id);
      state.myTeam.roster.push(p);
      clearFloorAdjustments(state.myTeam);
      state.log.push(`✍️ ${p.name} accepted your offer — ${offer.yrs}yr @ $${offer.sal.toFixed(2)}M`);
      if(!state.faLog) state.faLog = [];
      state.faLog.unshift(`<span style="color:var(--text2);">FA</span> <span style="color:#fff;font-weight:600;">${p.name}</span> <span class="pos-badge" style="font-size:10px;padding:1px 5px;">${p.pos}</span> <span style="color:var(--text2);">${p.ovr} OVR</span> → <span style="color:var(--gold);">⭐ ${state.myTeam.name}</span> <span style="color:var(--text2);">$${offer.sal.toFixed(1)}M/${offer.yrs}yr</span>`);
      notifications.push({ name: p.name, accepted: true });
    } else {
      // Rejected — player stays in FA pool (already there)
      state.log.push(`❌ ${p.name} declined your offer and remains in free agency.`);
      notifications.push({ name: p.name, accepted: false });
    }
    resolved.push(offer.id);
  });

  state.faPendingOffers = state.faPendingOffers.filter(o => !resolved.includes(o.id));

  if(notifications.length === 1){
    const n = notifications[0];
    showFlash(n.accepted ? '✍️ Signed!' : '❌ Declined', `${n.name} ${n.accepted ? 'accepted your offer!' : 'turned you down.'}`, n.accepted ? 'win' : 'loss');
  } else if(notifications.length > 1){
    const signed = notifications.filter(n => n.accepted).length;
    showFlash(`FA Results`, `${signed}/${notifications.length} offers accepted.`, signed > 0 ? 'win' : 'otl');
  }
}

// CPU teams make FA offers — players stay in state.fa; offers are tracked separately
function cpuMakeOffers(){
  if(!state || !state.fa) return;
  if(!state.cpuPendingOffers) state.cpuPendingOffers = [];

  const { NHL_MIN: MIN_OVR } = AFFILIATE_TIERS; // CPU only offers on NHL-calibre players
  const UPGRADE_OVR = 4;
  const isOffseason = state.calendar && (state.calendar.phase === PHASES.FREE_AGENCY || state.calendar.phase === PHASES.OFFSEASON || state.calendar.phase === PHASES.RESIGN);
  const ROSTER_MAX = isOffseason ? 30 : 23; // expanded limit lets CPU teams stockpile during offseason
  const POSITIONS = ['C','LW','RW','LD','RD','G'];

  function capRoom(team){ return BUDGET - team.roster.reduce((s,p) => s + p.salary, 0); }
  function worstAt(team, pos){ return team.roster.filter(p => p.pos === pos).sort((a,b) => a.ovr - b.ovr)[0]; }

  // Players already offered by user — CPU can still offer but player will weigh both
  const userOfferedIds = new Set((state.faPendingOffers || []).map(o => o.id));

  const teams = [...state.others].sort(() => Math.random() - 0.5);

  teams.forEach(team => {
    if(team.roster.length >= ROSTER_MAX) return;
    const room = capRoom(team);
    if(room < league.minSalary) return;

    const needs = teamPositionNeeds(team);
    const topNeed = Object.entries(needs).sort((a,b) => b[1]-a[1])[0];

    // Already made an offer today?
    const alreadyOffered = new Set(state.cpuPendingOffers.filter(o => o.teamId === team.id).map(o => o.id));

    // 1. Fill genuine holes first
    if(topNeed && topNeed[1] >= 0.2){
      const pos = topNeed[0];
      const target = state.fa.filter(p =>
        !alreadyOffered.has(p.id) &&
        p.pos === pos && p.ovr >= MIN_OVR && p.salary <= room
      ).sort((a,b) => b.ovr - a.ovr)[0];

      if(target && Math.random() < 0.88){
        state.cpuPendingOffers.push({ id: target.id, teamId: team.id, teamName: team.name, salary: target.salary, years: contractYears(target.ovr, target.age) });
        return;
      }
    }

    // 2. Upgrade: find a FA who clearly beats an incumbent
    for(const pos of POSITIONS){
      const worst = worstAt(team, pos);
      if(!worst) continue;

      const target = state.fa.filter(p =>
        !alreadyOffered.has(p.id) &&
        p.pos === pos && p.ovr >= worst.ovr + UPGRADE_OVR &&
        p.salary <= room + worst.salary && p.ovr >= MIN_OVR
      ).sort((a,b) => b.ovr - a.ovr)[0];

      if(target && Math.random() < 0.72){
        state.cpuPendingOffers.push({ id: target.id, teamId: team.id, teamName: team.name, salary: target.salary, years: contractYears(target.ovr, target.age), cutId: worst.id });
        break;
      }
    }
  });
}


// Resolve all pending offers (user + CPU) on sim day.
// Players stay in state.fa until resolved; best offer wins per player.
function resolveCpuOffers(){
  if(!state.cpuPendingOffers || !state.cpuPendingOffers.length) return;
  const cal = state.calendar;
  const { NHL_MIN, AHL_MIN } = AFFILIATE_TIERS;
  const resolved = new Set();

  // Group CPU offers by player
  const offersByPlayer = {};
  state.cpuPendingOffers.forEach(o => {
    if(!offersByPlayer[o.id]) offersByPlayer[o.id] = [];
    offersByPlayer[o.id].push(o);
  });

  Object.entries(offersByPlayer).forEach(([playerId, offers]) => {
    const p = state.fa.find(x => x.id === playerId);
    if(!p){ offers.forEach(o => resolved.add(o.id + o.teamId)); return; }

    // Check if user also offered — user offer competes too
    const userOffer = (state.faPendingOffers || []).find(o => o.id === playerId);

    // Pick the best offer (highest salary); add small random factor for realism
    const allOffers = [
      ...offers.map(o => ({ ...o, isUser: false, score: o.salary * (0.9 + Math.random() * 0.2) })),
      ...(userOffer ? [{ ...userOffer, salary: userOffer.sal, isUser: true, score: userOffer.sal * (0.9 + Math.random() * 0.2) * traitFAWillingness(p, state.myTeam) }] : []),
    ].sort((a,b) => b.score - a.score);

    const winner = allOffers[0];

    if(winner.isUser){
      // User wins — resolvePendingOffers() will handle the actual signing
      // Just mark the CPU offers as resolved; leave user offer in faPendingOffers
      offers.forEach(o => resolved.add(o.id + o.teamId));
      return;
    }

    // CPU team wins — sign the player
    const { accepts } = contractAcceptance(p, winner.salary, winner.years);
    if(!accepts && Math.random() > 0.15){
      // Player rejected all offers — stays in FA
      offers.forEach(o => resolved.add(o.id + o.teamId));
      if(userOffer){
        // Also cancel user's offer
        state.faPendingOffers = state.faPendingOffers.filter(o => o.id !== playerId);
        state.log.push(`❌ ${p.name} rejected all offers and remains in free agency.`);
      }
      return;
    }

    // If user had an offer on this player, they got outbid
    if(userOffer){
      state.faPendingOffers = state.faPendingOffers.filter(o => o.id !== playerId);
      showFlash('Outbid!', `${p.name} signed with ${winner.teamName} for $${winner.salary.toFixed(1)}M.`, 'loss');
      state.log.push(`💸 Outbid: ${p.name} signed with ${winner.teamName} — $${winner.salary.toFixed(1)}M/${winner.years}yr`);
    }

    const team = state.others.find(t => t.id === winner.teamId);
    if(!team){ offers.forEach(o => resolved.add(o.id + o.teamId)); return; }

    // Remove from FA
    state.fa = state.fa.filter(x => x.id !== playerId);
    p.years  = winner.years;
    p.salary = winner.salary;
    p.capPct = salaryToCapPct(winner.salary);

    if(!team.cpuAHL)  team.cpuAHL  = { roster: [] };
    if(!team.cpuECHL) team.cpuECHL = { roster: [] };

    if(winner.cutId){
      const cutIdx = team.roster.findIndex(x => x.id === winner.cutId);
      if(cutIdx !== -1){
        const cut = team.roster.splice(cutIdx, 1)[0];
        cut._myTeam = false;
        if(cut.ovr >= NHL_MIN) state.fa.push(cut);
      }
    }

    p._affiliate = null; team.roster.push(p);
    while(team.roster.length > 23){
      const worst = [...team.roster].sort((a,b) => a.ovr - b.ovr)[0];
      team.roster.splice(team.roster.indexOf(worst), 1);
      if(worst.ovr >= AHL_MIN){ worst._affiliate = 'cpuAHL'; team.cpuAHL.roster.push(worst); }
      else { worst._affiliate = 'cpuECHL'; team.cpuECHL.roster.push(worst); }
    }

    if(!state.faLog) state.faLog = [];
    const dateLabel = cal ? `${SEASON_MONTHS[cal.currentMonth].name.slice(0,3)} ${cal.currentDay}` : `FA`;
    state.faLog.unshift(`<span style="color:var(--text2);">${dateLabel}</span> <span style="color:#fff;font-weight:600;">${p.name}</span> <span class="pos-badge" style="font-size:10px;padding:1px 5px;">${p.pos}</span> <span style="color:var(--text2);">${p.ovr} OVR</span> → <span style="color:var(--gold);">${team.name}</span> <span style="color:var(--text2);">$${winner.salary.toFixed(1)}M</span>`);
    if(state.faLog.length > 80) state.faLog.pop();

    offers.forEach(o => resolved.add(o.id + o.teamId));
  });

  state.cpuPendingOffers = state.cpuPendingOffers.filter(o => !resolved.has(o.id + o.teamId));
}

function simFADay(){
  if(!state || !state.calendar) return;
  const cal = state.calendar;

  // 1. Resolve all pending offers (player and CPU) simultaneously
  resolvePendingOffers();
  resolveCpuOffers();

  // 2. Advance calendar by 1 day
  const curSeasonDay = SEASON_MONTHS.slice(0, cal.currentMonth).reduce((s,m) => s + m.days, 0) + (cal.currentDay - 1);
  const nextSeasonDay = curSeasonDay + 1;
  let newMonth = 0, newDay = 1;
  let rem = nextSeasonDay;
  for(let m = 0; m < SEASON_MONTHS.length; m++){
    if(rem < SEASON_MONTHS[m].days){ newMonth = m; newDay = rem + 1; break; }
    rem -= SEASON_MONTHS[m].days;
  }
  cal.currentMonth = newMonth;
  cal.currentDay = newDay;
  cal.viewMonth = newMonth;
  cal.viewYear = newMonth >= 3 ? cal.year + 1 : cal.year;

  // 3. CPU teams make new offers for the next day
  cpuMakeOffers();

  checkPhaseTransition();
  renderAll();
}

function showRetirements(){
  const retirements = state.retirements || [];
  const el = document.getElementById('retirements-list');
  if(!el) return;
  if(!retirements.length){
    el.innerHTML = '<p style="color:var(--text2);font-size:13px;">No notable retirements this offseason.</p>';
  } else {
    const myRetirements = retirements.filter(r => r.myTeam);
    const otherRetirements = retirements.filter(r => !r.myTeam);
    let html = '';
    if(myRetirements.length){
      html += '<div style="font-family:Barlow Condensed,sans-serif;font-size:12px;font-weight:700;color:var(--red2);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">From Your Roster</div>';
      myRetirements.forEach(r => {
        html += '<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:rgba(192,57,43,0.08);border:1px solid rgba(192,57,43,0.2);border-radius:6px;margin-bottom:8px;">'
          + '<div style="font-size:26px;">🏁</div>'
          + '<div>'
          + '<div style="font-weight:600;font-size:14px;">' + r.name + ' <span style="font-size:11px;color:var(--text2);">(' + r.pos + ', age ' + r.age + ', ' + r.ovr + ' OVR)</span></div>'
          + '<div style="font-size:12px;color:var(--text2);margin-top:2px;">' + r.summary + '</div>'
          + '</div></div>';
      });
    }
    if(otherRetirements.length){
      html += '<div style="font-family:Barlow Condensed,sans-serif;font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin:12px 0 8px;">Around the League (' + otherRetirements.length + ')</div>';
      html += '<div style="background:var(--rink2);border:1px solid var(--border);border-radius:6px;overflow:hidden;">';
      otherRetirements.forEach((r,i) => {
        html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:' + (i<otherRetirements.length-1?'1px solid rgba(100,160,220,0.07)':'none') + ';">'
          + '<div><span style="font-weight:500;font-size:13px;">' + r.name + '</span> <span style="font-size:11px;color:var(--text2);">· ' + r.pos + ' · ' + r.team + '</span></div>'
          + '<div style="font-size:11px;color:var(--text2);text-align:right;">Age ' + r.age + ' · ' + r.summary + '</div>'
          + '</div>';
      });
      html += '</div>';
    }
    el.innerHTML = html;
  }
  document.getElementById('modal-retirements').classList.add('open');
}

function startNewSeason(){
  state.season++;
  state.week = 1;
  state.playoffsStarted = false;
  state.bracket = null;
  state.offseasonPhase = null;
  state.draftClass = null;
  state.draftLog = null;
  state.morale = 0;
  // Reset records
  allTeams().forEach(t=>{ t.w=0; t.l=0; t.otl=0; });
  // Fresh FA pool
  // Salary cap grows each season
  league.salaryCap = Math.round((league.salaryCap + rnd(2,4)) * 10) / 10;
  state.fa = []; // FA pool rebuilds from expiring contracts at startOffseason
  advancePickInventory();
  // Reset calendar to Regular Season for new year
  const newYear2 = (state.calendar?.year || 2025) + 1;
  state.calendar = freshCalendar(newYear2);
  state.week = 1;
  state.schedule = generateSchedule();
  state.nextSeasonSchedule = null;
  // Archive current season stats into player history before resetting
  const archiveSeason = state.season - 1; // season just ended
  allTeams().forEach(t => archiveTeamSeasonStats(t, archiveSeason, LEAGUE_NAMES.pro));
  archiveTeamSeasonStats(state.ahl, archiveSeason, LEAGUE_NAMES.minor);
  archiveTeamSeasonStats(state.echl, archiveSeason, LEAGUE_NAMES.low);
  state.ahl.w=0; state.ahl.l=0; state.ahl.otl=0; state.ahl.log=[];
  // Validate lines — remove players no longer on roster
  if(state.lines){
    state.lines.forwards.forEach(line=>{ line.players=line.players.map(id=>state.myTeam.roster.find(p=>p.id===id)?id:null); });
    state.lines.defense.forEach(pair=>{ pair.players=pair.players.map(id=>state.myTeam.roster.find(p=>p.id===id)?id:null); });
    if(!state.myTeam.roster.find(p=>p.id===state.lines.goalies.starter)) state.lines.goalies.starter=null;
    if(!state.myTeam.roster.find(p=>p.id===state.lines.goalies.backup)) state.lines.goalies.backup=null;
  }
  autoSetLines();
  state.echl.w=0; state.echl.l=0; state.echl.otl=0; state.echl.log=[];
  // Hide offseason tabs
  ['tab-playoffs','tab-resign','tab-draft'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='none'; });
  // Reset trade sel
  const tradeSel = document.getElementById('trade-team-sel'); if(tradeSel) tradeSel.innerHTML='';
  state.log = [`🏒 Season ${state.season} underway! Cap floor compliance will apply when you sim the first week.`];

  renderAll();
  showTab('roster');
  showFlash('Season '+state.season+' Begins!', 'Good luck, GM.', 'win');
}
