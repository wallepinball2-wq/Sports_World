// ---- Top-level state (declared first to avoid temporal dead zone) ----
let selectedTeamName = null;
let teamPreviewCache = {};

// --- SPECIALIZED ROSTER TIERS ---
// REBUILDING: Lower overalls, but younger ages
const rebuildingFwdTiers = [
  [83, 86, 20, 23], [81, 84, 20, 24], [79, 82, 20, 25],
  [78, 81, 21, 26], [77, 80, 21, 27], [76, 79, 22, 28],
  [76, 79, 23, 29], [76, 78, 21, 31], [76, 78, 20, 33],
  [76, 78, 20, 33], [76, 78, 20, 33], [76, 78, 20, 33]
];
// OFFENSIVE/CONTENDER: High-end prime talent
const offensiveFwdTiers = [
  [90, 96, 23, 29], [87, 91, 22, 31], [85, 89, 22, 31],
  [84, 87, 24, 32], [83, 86, 24, 32], [82, 85, 24, 33],
  [81, 84, 25, 33], [80, 83, 25, 34], [79, 82, 22, 35],
  [78, 81, 22, 35], [77, 80, 21, 35], [76, 79, 20, 35]
];
// DEFENSIVE: Slightly lower top-end forwards
const defensiveFwdTiers = [
  [86, 91, 24, 30], [84, 88, 24, 32], [83, 86, 24, 32],
  [82, 85, 25, 33], [81, 84, 25, 33], [80, 83, 25, 34],
  [79, 82, 26, 35], [78, 81, 26, 35], [77, 80, 22, 35],
  [76, 79, 21, 35], [76, 79, 20, 35], [76, 78, 20, 35]
];

// ---- OVR Tier System (declared early — used by applyOvrTierCSS and others) ----
const OVR_TIER_DEFAULTS = [
  { min:90, color:'#FFD700', label:'Elite'      },
  { min:80, color:'#2ecc71', label:'Star'       },
  { min:70, color:'#5dade2', label:'Starter'    },
  { min:60, color:'#9b59b6', label:'Fringe'     },
  { min:50, color:'#e67e22', label:'AHL'        },
  { min:40, color:'#e74c3c', label:'Depth'      },
  { min:30, color:'#7f8c8d', label:'Prospect'   },
  { min:20, color:'#555f6b', label:'Developing' },
  { min:10, color:'#3d4450', label:'Raw'        },
  { min:0,  color:'#2c3138', label:'Unrated'    },
];
function loadOvrTiers(){
  try { const saved = localStorage.getItem('ovrTiers'); if(saved) return JSON.parse(saved); } catch(e){}
  return OVR_TIER_DEFAULTS.map(t => ({...t}));
}
function saveOvrTiers(tiers){ try{ localStorage.setItem('ovrTiers', JSON.stringify(tiers)); }catch(e){} }
let OVR_TIERS = loadOvrTiers();

// ---- League & Contract System ----
const league = {
  salaryCap: 104,          // total cap ceiling in $M
  capFloorPct: 75,         // floor = 75% of cap (teams must spend at least this %)
  minSalary: 0.775,        // league minimum per player in $M
  starterSharePct: 65,     // % of games started by the #1 goalie (default 65 = ~53 of 82)
  get cap(){ return this.salaryCap; },
  get capFloor(){ return Math.round(this.salaryCap * this.capFloorPct / 100 * 100) / 100; }, // floor in $M
  get capFloorPct_(){ return this.capFloorPct; }
};

// Season phases in order
var PHASES = {
  PRESEASON:      'Preseason',
  REGULAR_SEASON: 'Regular Season',
  TRADE_DEADLINE: 'Trade Deadline',
  PLAYOFFS:       'Playoffs',
  DRAFT:          'Draft',
  RESIGN:         'Re-Signing',
  FREE_AGENCY:    'Free Agency',
  OFFSEASON:      'Offseason',
};
const SEASON_MONTHS = [
  { name:'September', days:30, offseason:false }, // Preseason
  { name:'October',   days:31, offseason:false },
  { name:'November',  days:30, offseason:false },
  { name:'December',  days:31, offseason:false },
  { name:'January',   days:31, offseason:false },
  { name:'February',  days:28, offseason:false },
  { name:'March',     days:31, offseason:false },
  { name:'April',     days:30, offseason:false },
  { name:'May',       days:31, offseason:true  },
  { name:'June',      days:30, offseason:true  },
  { name:'July',      days:31, offseason:true  },
  { name:'August',    days:31, offseason:true  },
];
// Game days per week: Tue=2, Thu=4, Sat=6 (0=Sun)
const GAME_DAYS = [2, 4, 6];

// ----------------------------------------------------------------
// PHASE DATE ANCHORS — all phase transitions driven by real dates
// ----------------------------------------------------------------
const PHASE_DATES = {
  tradeDeadline:     { month: 'February', day: 28 }, // Trade deadline (end of Feb)
  tradeDeadlineEnd:  { month: 'March',    day:  1 }, // Resume regular season
  regularSeasonEnd:  { month: 'April',    day: 17 }, // Last regular season day
  playoffsEnd:       { month: 'June',     day: 20 }, // Playoffs wrap up by here
  draftDay:          { month: 'June',     day: 26 }, // Entry Draft
  resignStart:       { month: 'July',     day:  1 }, // Re-signing window opens
  freeAgencyStart:   { month: 'July',     day:  7 }, // Free agency opens
  offseasonStart:    { month: 'August',   day:  1 }, // General offseason prep
};

// Legacy alias so old code that references TRADE_DEADLINE still works
const TRADE_DEADLINE = PHASE_DATES.tradeDeadline;

// Convert a named month + day to an absolute 0-based day-of-season index
function phaseDateToSeasonDay(month, day){
  const mIdx = SEASON_MONTHS.findIndex(m => m.name === month);
  if(mIdx < 0) return 9999;
  return SEASON_MONTHS.slice(0, mIdx).reduce((s, m) => s + m.days, 0) + (day - 1);
}

// Return the 0-based season-day index of the calendar's current position
function calSeasonDay(cal){
  return SEASON_MONTHS.slice(0, cal.currentMonth).reduce((s, m) => s + m.days, 0) + (cal.currentDay - 1);
}

// True if the calendar is on or after the given named date
function isOnOrAfterDate(cal, month, day){
  return calSeasonDay(cal) >= phaseDateToSeasonDay(month, day);
}

// Derive regularSeasonWeeks and tradeDeadlineWeek from PHASE_DATES
// (used for progress bar and legacy guards)
const _rsEndDay  = phaseDateToSeasonDay(PHASE_DATES.regularSeasonEnd.month,  PHASE_DATES.regularSeasonEnd.day);
const _tdDay     = phaseDateToSeasonDay(PHASE_DATES.tradeDeadline.month,     PHASE_DATES.tradeDeadline.day);
const REGULAR_SEASON_WEEKS  = Math.ceil((_rsEndDay  + 1) / 7);
const TRADE_DEADLINE_WEEK   = Math.ceil((_tdDay     + 1) / 7);

const POTENTIAL_TIERS = {
  F: [
    { role:'Franchise Forward',  ovrRange:[93,99], weight:1   }, // ~1-2 per league
    { role:'Elite Forward',      ovrRange:[88,92], weight:4   }, // ~8-12 league-wide
    { role:'Top 6 Forward',      ovrRange:[83,87], weight:14  }, // solid contributors
    { role:'Top 9 Forward',      ovrRange:[79,83], weight:28  }, // most common good player
    { role:'Bottom 6 Forward',   ovrRange:[76,79], weight:53  }, // depth/role players
  ],
  D: [
    { role:'Franchise Defenseman',   ovrRange:[93,99], weight:1   },
    { role:'Elite Defenseman',       ovrRange:[88,92], weight:4   },
    { role:'Top Pair Defenseman',    ovrRange:[83,87], weight:14  },
    { role:'Top 4 Defenseman',       ovrRange:[79,83], weight:28  },
    { role:'Bottom Pair Defenseman', ovrRange:[76,79], weight:53  },
  ],
  G: [
    { role:'Franchise Goalie', ovrRange:[93,99], weight:1   }, // generational rarity
    { role:'Elite Goalie',     ovrRange:[87,92], weight:3   }, // ~5-8 league-wide
    { role:'Starting Goalie',  ovrRange:[81,86], weight:18  }, // 1 per team typical
    { role:'Backup Goalie',    ovrRange:[76,80], weight:78  }, // clearly weaker
  ],
};
// Tier color coding — franchise/elite stand out, depth is muted
const TIER_COLORS = {
  'Franchise Forward':      '#5dade2',
  'Franchise Defenseman':   '#5dade2',
  'Franchise Goalie':       '#5dade2',
  'Elite Forward':          '#2ecc71',
  'Elite Defenseman':       '#2ecc71',
  'Elite Goalie':           '#2ecc71',
  'Top 6 Forward':          '#aed6f1',
  'Top Pair Defenseman':    '#aed6f1',
  'Starting Goalie':        '#aed6f1',
  'Top 9 Forward':          '#d5dbdb',
  'Top 4 Defenseman':       '#d5dbdb',
  'Backup Goalie':          '#d5dbdb',
  'Bottom 6 Forward':       '#7f8c8d',
  'Bottom Pair Defenseman': '#7f8c8d',
  'Depth Goalie':           '#7f8c8d',
  'Depth Forward':          '#566573',
  'Depth Defenseman':       '#566573',
};
const TAB_GROUP = {
  roster:'team', lines:'team', affiliates:'team', contracts:'team', log:'team', waivers:'transactions',
  standings:'league', playoffs:'league', power:'league', calendar:'league', leaders:'league',
  fa:'transactions', trade:'transactions', resign:'transactions', draft:'transactions',
  settings:'management',
};
class Contract {
  constructor(capPct, years){
    this.capPct = capPct;       // percentage of salary cap e.g. 8.5
    this.years = years;
    this.yearsRemaining = years;
  }
  get salary(){ return Math.round(league.salaryCap * this.capPct / 100 * 100) / 100; }
  get totalValue(){ return Math.round(this.salary * this.years * 100) / 100; }
}

// Helper: convert $M salary to cap %
function salaryToCapPct(salM){ return Math.round(salM / league.salaryCap * 1000) / 10; }
// Helper: convert cap % to $M salary
function capPctToSalary(pct){ return Math.round(league.salaryCap * pct / 100 * 100) / 100; }

const BUDGET = league.salaryCap; // keep compatibility

// ---- Free Agency Pending Offers ----
// During FA (July 7–31), offers go pending for 1 sim day before player decides.

// ---- Entry Level Contract (ELC) System ----
const ELC = {
  maxSalary: 0.925,   // $925K cap hit max
  maxYears: 3,        // max 3 years
  maxAge: 21,         // players 18-21 qualify for ELC
};

// Check if a player is currently on an ELC
function isELC(p){ return !!p.isELC; }

// Check if a player is ELC-eligible (just drafted, age 18-21)
function isELCEligible(p){ return p.isDraftee && p.age <= ELC.maxAge; }
const MAX_WEEKS = 82;
const POSITIONS = ['C','LW','RW','LD','RD','G'];
const FIRSTS = [
  'Adler','Alaric','Anders','Ansel','Arden','Arlo','Atlas','August','Axel','Barrett',
  'Beckett','Benedict','Boden','Boone','Bowen','Bram','Brecken','Brooks','Callum','Caspian',
  'Cato','Cedric','Colter','Conrad','Cormac','Dashiell','Declan','Dexton','Dorian','Eamon',
  'Elias','Emmett','Enzo','Ewan','Ezra','Felix','Finnian','Fletcher','Flynn','Gage',
  'Gideon','Griffin','Gunnar','Harlan','Hayes','Hendrix','Hugo','Huxley','Ibsen','Ignatius',
  'Iver','Jasper','Jethro','Jude','Kael','Kellan','Kiefer','Killian','Knox','Lachlan',
  'Lars','Leif','Lenz','Lexton','Linus','Lowell','Lucian','Magnus','Marek','Marius',
  'Milo','Nico','Nils','Nolan','Orion','Oscar','Otto','Otis','Pascal','Pavel',
  'Quentin','Quill','Rafferty','Rafe','Reid','Remy','Rhys','Ridge','Ronan','Roscoe',
  'Rowan','Ryker','Silas','Soren','Stellan','Sven','Thatcher','Thayer','Torsten','Tristan',
  'Urban','Vance','Vaughn','Victor','Viggo','Wilder','Willem','Xander','Zane','Zephyr'
];

const LASTS = [
  'Aaby','Ames','Bakke','Barlow','Beck','Berg','Blackwood','Blythe','Borg','Bourne',
  'Brooks','Calder','Carne','Channing','Corbin','Craggs','Cross','Crowe','Dahl','Dixon',
  'Drake','Eklund','Ellery','Falk','Fane','Finch','Flint','Foster','Gale','Garrick',
  'Gentry','Glass','Grier','Grimes','Hale','Hall','Hart','Hawthorne','Hayes','Holm',
  'Holt','Hurst','Ivers','Jace','Jarvis','Jorgenson','Kane','Keating','Kemp','Kingsley',
  'Knott','Laine','Lantz','Larkin','Lenz','Lind','Loke','Lund','Main','Marek',
  'Marsh','Merrit','Miller','Morgans','Morrow','Nash','Niles','Nord','Nyberg','Oakes',
  'Oland','Pace','Park','Pike','Quinn','Raine','Raske','Reed','Reeve','Ridge',
  'Rivers','Rixon','Roark','Roux','Ryder','Savage','Skagen','Slade','Sloan','Sorenson',
  'Steel','Sterling','Stone','Strand','Taggart','Talbot','Thorne','Tierney','Tuma','Vance',
  'Vane','Vester','Voda','Wade','Ward','West','Wick','Wolfe','Worth','Zale'
];

// ADD THESE TWO LINES HERE:
let playerPageId = null;
let playerPageTab = 'overview';

// ---- Mascot Pool ----
const MASCOTS = [
  // Animals — mammals
  'Bears','Wolves','Lions','Tigers','Panthers','Cougars','Lynx','Bobcats','Jaguars','Leopards',
  'Cheetahs','Foxes','Coyotes','Badgers','Wolverines','Otters','Beavers','Muskrats','Raccoons',
  'Moose','Elk','Bison','Bulls','Rams','Stallions','Mustangs','Broncos','Colts','Mules',
  'Deer','Stags','Antelope','Gorillas','Chimps','Baboons','Wombats','Kangaroos','Koalas',
  'Pandas','Grizzlies','Seals','Walruses','Orcas','Dolphins','Whales','Narwhals','Manatees',
  'Minks','Ferrets','Weasels','Hares','Rabbits','Squirrels','Chipmunks','Marmots','Bats',
  // Animals — birds
  'Eagles','Hawks','Falcons','Ospreys','Vultures','Condors','Owls','Ravens','Crows','Jays',
  'Herons','Egrets','Cranes','Pelicans','Penguins','Puffins','Gulls','Ducks','Geese','Swans',
  'Loons','Pheasants','Grouse','Turkeys','Peacocks','Ostriches',
  // Animals — reptiles
  'Gators','Crocodiles','Iguanas','Geckos','Chameleons','Monitors',
  'Cobras','Vipers','Mambas','Pythons','Rattlers','Copperheads','Tortoises','Turtles',
  // Animals — fish & sea creatures
  'Sharks','Marlins','Swordfish','Barracudas','Piranhas','Tunas','Salmon','Trout',
  'Bass','Walleye','Pike','Muskies','Eels','Rays','Squid','Octopi','Jellyfish',
  'Crabs','Lobsters','Shrimp','Urchins','Starfish',
  // Animals — insects & arachnids
  'Hornets','Wasps','Bees','Ants','Beetles','Dragonflies','Mantis','Crickets',
  'Locusts','Scorpions','Spiders','Tarantulas',
  // Mythical & fantasy
  'Dragons','Phoenixes','Griffins','Unicorns','Hydras','Krakens','Leviathans','Behemoths',
  'Chimeras','Wyverns','Phantoms','Ghosts','Wraiths','Banshees','Specters','Shadows',
  'Demons','Devils','Gargoyles','Golems','Giants','Titans','Trolls','Goblins',
  'Valkyries','Angels','Yetis','Sasquatch','Wendigos','Sirens','Harpies',
  // Weather & nature
  'Storm','Thunder','Lightning','Blizzard','Avalanche','Cyclone','Tornado','Hurricane',
  'Tempest','Gale','Frost','Freeze','Glacier','Inferno','Wildfire','Ember','Lava',
  'Vortex','Maelstrom','Tsunami','Torrent','Rapids','Cascade','Surge','Tide',
  // Tough & intimidating
  'Warriors','Raiders','Outlaws','Bandits','Renegades','Rebels','Marauders','Pirates',
  'Vikings','Berserkers','Gladiators','Spartans','Legions','Knights','Crusaders',
  'Predators','Hunters','Rangers','Sentinels','Guardians','Enforcers','Strikers',
  'Blades','Sabers','Lancers','Cannons','Rockets','Bombers',
  // Hockey-flavored
  'Force','Fury','Rage','Wrath','Havoc','Mayhem','Chaos','Rampage','Crush','Impact',
  'Kings','Queens','Royals','Monarchs','Commanders','Captains','Admirals','Aces'
];

// Generate 32 unique "City Mascot" team names
function generateLeagueNames() {
  const shuffledCities = [...US_CITIES].sort(() => Math.random() - 0.5);
  const shuffledMascots = [...MASCOTS].sort(() => Math.random() - 0.5);
  const names = [];
  const usedMascots = new Set();
  let mi = 0;
  for (let i = 0; i < 32; i++) {
    while (usedMascots.has(shuffledMascots[mi])) mi++;
    usedMascots.add(shuffledMascots[mi]);
    names.push(shuffledCities[i] + ' ' + shuffledMascots[mi]);
    mi++;
  }
  return names;
}

// NHL-style league structure (slots filled at game start)
const DIVISIONS = {
  'Atlantic':     Array(8).fill(null),
  'Metropolitan': Array(8).fill(null),
  'Central':      Array(8).fill(null),
  'Pacific':      Array(8).fill(null),
};
const CONFERENCES = { 'Eastern': ['Atlantic','Metropolitan'], 'Western': ['Central','Pacific'] };
let TEAM_NAMES = [];

let signTarget = null, releaseTarget = null;
let signClause = null;
let extendClause = null;

const CLAUSE_DESCS = {
  NMC:   { label:'No-Movement Clause', desc:'Player cannot be traded or sent to minors.', color:'var(--red2)' },
  'M-NMC':{ label:'Modified NMC', desc:'NMC for first half of contract, then converts to NTC.', color:'var(--gold)' },
  NTC:   { label:'No-Trade Clause', desc:'Player submits a list of 10 teams they cannot be traded to.', color:'#5dade2' },
};

// ---- Two-Way Contract System ----
// isTwoWay: player has two-way deal; minorSalary stored on player
// When assigned to AHL/ECHL: swap salary → minorSalary (cap relief)
// When called up: restore nhlSalary

function updateSignTwoWay(){
  const on = document.getElementById('sign-twoway-toggle').checked;
  const inputs = document.getElementById('sign-twoway-inputs');
  const track  = document.getElementById('sign-twoway-track');
  const thumb  = document.getElementById('sign-twoway-thumb');
  if(inputs) inputs.style.display = on ? 'block' : 'none';
  if(track)  track.style.background  = on ? 'var(--accent)' : 'rgba(255,255,255,0.12)';
  if(thumb)  thumb.style.left        = on ? '21px' : '3px';
  updateContractPreview();
}

function updateExtendTwoWay(){
  const on = document.getElementById('extend-twoway-toggle').checked;
  const inputs = document.getElementById('extend-twoway-inputs');
  const track  = document.getElementById('extend-twoway-track');
  const thumb  = document.getElementById('extend-twoway-thumb');
  if(inputs) inputs.style.display = on ? 'block' : 'none';
  if(track)  track.style.background  = on ? 'var(--accent)' : 'rgba(255,255,255,0.12)';
  if(thumb)  thumb.style.left        = on ? '21px' : '3px';
  updateExtendPreview();
}

function resetSignTwoWay(){
  const tog = document.getElementById('sign-twoway-toggle');
  if(tog) tog.checked = false;
  updateSignTwoWay();
}

function resetExtendTwoWay(){
  const tog = document.getElementById('extend-twoway-toggle');
  if(tog) tog.checked = false;
  updateExtendTwoWay();
}

function twoWayBadge(){
  return `<span title="Two-Way Contract" style="font-size:10px;font-family:'Barlow Condensed',sans-serif;font-weight:700;padding:1px 5px;border-radius:3px;background:rgba(41,128,185,0.18);color:#5dade2;border:1px solid rgba(41,128,185,0.4);cursor:help;margin-left:4px;">2-WAY</span>`;
}

function setSignClause(clause){
  signClause = clause;
  ['none','NMC','M-NMC','NTC'].forEach(c=>{
    const btn = document.getElementById('sign-clause-'+(c==='none'?'none':c));
    if(btn) btn.style.borderColor = ((clause===null&&c==='none')||clause===c) ? 'var(--accent)' : 'var(--border)';
    if(btn) btn.style.color = ((clause===null&&c==='none')||clause===c) ? 'var(--ice)' : 'var(--text2)';
  });
  const desc = document.getElementById('sign-clause-desc');
  if(desc) desc.innerHTML = clause ? `<span style="color:${CLAUSE_DESCS[clause].color};">${CLAUSE_DESCS[clause].label}:</span> ${CLAUSE_DESCS[clause].desc}` : '';
}

function setExtendClause(clause){
  extendClause = clause;
  ['none','NMC','M-NMC','NTC'].forEach(c=>{
    const btn = document.getElementById('extend-clause-'+(c==='none'?'none':c));
    if(btn) btn.style.borderColor = ((clause===null&&c==='none')||clause===c) ? 'var(--accent)' : 'var(--border)';
    if(btn) btn.style.color = ((clause===null&&c==='none')||clause===c) ? 'var(--ice)' : 'var(--text2)';
  });
  const desc = document.getElementById('extend-clause-desc');
  if(desc) desc.innerHTML = clause ? `<span style="color:${CLAUSE_DESCS[clause].color};">${CLAUSE_DESCS[clause].label}:</span> ${CLAUSE_DESCS[clause].desc}` : '';
}
let rosterSort = { key:'pos', dir:1 };
let faSort = { key:'ovr', dir:-1 };
let draftSort = { key:'ovr', dir:-1 };
let faPage = 0;
const FA_PAGE_SIZE = 25;
let draftPage = 0;
const DRAFT_PAGE_SIZE = 25;

let flashTimer = null;

function rnd(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function pname(){ return pick(FIRSTS)+' '+pick(LASTS); }
function salFromOVR(ovr){
  // Returns salary in $M derived from cap percentage ranges per OVR
  if(ovr < 80) return league.minSalary;
  // Cap % ranges per OVR — [min%, max%]
  // Tuned so a full 23-man roster lands at ~85-95% cap used
  const PCT_TABLE = {
    80:[1.5,2.0],  81:[2.0,2.6],
    82:[2.6,3.2],  83:[3.2,4.0],
    84:[4.0,5.0],  85:[5.0,6.0],
    86:[6.0,7.0],  87:[7.0,8.2],
    88:[8.2,9.2],  89:[9.2,10.2],
    90:[10.2,11.0], 91:[11.0,11.8],
    92:[11.8,12.5], 93:[12.5,13.0],
    94:[13.0,13.5], 95:[13.5,13.9],
    96:[13.9,14.2], 97:[14.2,14.4],
    98:[14.4,14.55], 99:[14.55,14.7],
  };
  const cap = ovr >= 99 ? 99 : ovr;
  const [lo, hi] = PCT_TABLE[cap] || PCT_TABLE[99];
  // Random value within range, rounded to 2dp
  const pct = Math.round((lo + Math.random() * (hi - lo)) * 100) / 100;
  return capPctToSalary(pct);
}

function capPctFromOVR(ovr){
  return salaryToCapPct(salFromOVR(ovr));
}
function contractYears(ovr, age){
  // Stars in prime get long deals, old/bad players get short deals
  if(age >= 35) return 1;
  if(age >= 33) return rnd(1,2);
  if(ovr >= 88) return rnd(6,8);
  if(ovr >= 82) return rnd(4,7);
  if(ovr >= 75) return rnd(2,5);
  if(ovr >= 68) return rnd(1,3);
  return rnd(1,2);
}

let state;

// ---- Attribute System ----

// ----------------------------------------------------------------
// UNIFIED SKATER ATTRIBUTE SYSTEM
// 21 skill ratings across 4 groups. Each skill has 4 named sub-attributes
// for display/flavor — the skill rating is the single stored value.
// Archetypes define deviations from base OVR per skill.
// Positive = above OVR, negative = below OVR (in points).
// ----------------------------------------------------------------
const SKATER_ATTR_KEYS = [
  // Skating (5)
  'speed','acceleration','agility','balance','endurance',
  // Offensive (6)
  'shootingAccuracy','shotPower','passing','puckHandling','offensiveIQ','vision',
  // Defensive (6)
  'defensiveIQ','positioning','stickChecking','shotBlocking','faceoffs','poise',
  // Physical (4)
  'strength','checking','aggression','discipline',
];

// Sub-attributes: pure display/flavor — 4 per skill
const SKATER_ATTR_SUBS = {
  speed: {
    label: 'Speed',
    subs: [
      { key:'straightLineSpeed',   label:'Straight-Line Top Speed',   desc:'Maximum velocity in a straight line without the puck after full stride extension.' },
      { key:'puckCarryingSpeed',   label:'Puck-Carrying Speed',       desc:'Maximum velocity while maintaining active stickhandling control of the puck.' },
      { key:'backwardSkatingSpeed',label:'Backward Skating Speed',    desc:'Maximum velocity while moving backward to maintain gap control against rushers.' },
      { key:'crossoverSpeed',      label:'Linear Crossover Speed',    desc:'Maximum velocity sustained while using continuous lateral foot-over-foot crossovers on wide arcs.' },
    ],
  },
  acceleration: {
    label: 'Acceleration',
    subs: [
      { key:'firstStep',           label:'First-Step Quickness',      desc:'Explosive bursts from a standstill to mid-gear velocity instantly.' },
      { key:'puckCarryingAccel',   label:'Puck-Carrying Acceleration',desc:'Rate of speed increase while executing active puck-handling motions.' },
      { key:'transitionAccel',     label:'Transition Acceleration',   desc:'Speed recovery when pivoting instantly from backward to forward skating.' },
      { key:'stopStartBurst',      label:'Stop-and-Start Burst',      desc:'Recovery time and explosive power generated immediately after hard snowplow stops.' },
    ],
  },
  agility: {
    label: 'Agility',
    subs: [
      { key:'lateralCrossover',    label:'Lateral Crossover Speed',   desc:'Quickness of foot-over-foot cuts when shifting horizontally at high velocity.' },
      { key:'tightTurnRadius',     label:'Tight-Turn Radius',         desc:'Sharpness of a turn a player can execute without losing momentum.' },
      { key:'edgeWorkStability',   label:'Edge-Work Stability',       desc:'Ability to lean onto inside or outside blades to trick defenders without stumbling.' },
      { key:'pivotingFluidity',    label:'Pivoting Fluidity',         desc:'Smoothness of rotating 180° from forward to backward skating while maintaining motion.' },
    ],
  },
  balance: {
    label: 'Balance',
    subs: [
      { key:'checkingResistance',  label:'Checking Resistance',       desc:'Ability to absorb physical contact without being knocked off stride.' },
      { key:'stumbleRecovery',     label:'Stumble Recovery',          desc:'Speed and success rate of regaining footing after a trip or minor collision.' },
      { key:'unevenIceStability',  label:'Uneven Ice Stability',      desc:'Maintaining center of gravity through rutted ice, snow buildup, or crowded creases.' },
      { key:'dekeLeanControl',     label:'Deke Lean Control',         desc:'Capacity to lean body weight extreme distances during high-speed fakes without losing edge.' },
    ],
  },
  endurance: {
    label: 'Endurance',
    subs: [
      { key:'shiftLongevity',      label:'Shift Longevity',           desc:'Duration a player sustains peak performance before attribute degradation begins.' },
      { key:'burstDrain',          label:'Intense Burst Drain',       desc:'Rate of stamina depletion during full-velocity sprints and heavy body checks.' },
      { key:'intermissionRecovery',label:'Intermission Recovery',     desc:'Percentage of overall stamina restored during the break between periods.' },
      { key:'fatigueMitigation',   label:'Fatigue Mitigation',        desc:'Ability to resist immediate attribute penalties when completely exhausted.' },
    ],
  },
  shootingAccuracy: {
    label: 'Shooting Accuracy',
    subs: [
      { key:'wristShotAcc',        label:'Wrist Shot Accuracy',       desc:'Precision placing the puck via sweeping blade motion, typically during active rushes.' },
      { key:'slapShotAcc',         label:'Slap Shot Accuracy',        desc:'Precision striking the puck with a full wind-up, usually from the blue line.' },
      { key:'oneTimerAcc',         label:'One-Timer Accuracy',        desc:'Precision striking a moving pass directly without stopping the puck first.' },
      { key:'backhandAcc',         label:'Backhand Accuracy',         desc:'Precision shooting from the reverse blade side, where lift and control are harder.' },
    ],
  },
  shotPower: {
    label: 'Shot Power',
    subs: [
      { key:'wristShotVel',        label:'Wrist Shot Velocity',       desc:'Maximum puck speed launched via quick wrist snap or sweeping motion.' },
      { key:'slapShotVel',         label:'Slap Shot Velocity',        desc:'Absolute peak puck speed from a full heavy wind-up, maximizing stick flex.' },
      { key:'snapPower',           label:'Quick-Release Snap Power',  desc:'Force generated on sudden zero-prep snapshots where the player quickly snaps the wrists.' },
      { key:'deflectionPower',     label:'Deflection Power',          desc:'Momentum maintained or redirected when tipping a teammate\'s shot past the goalie.' },
    ],
  },
  passing: {
    label: 'Passing',
    subs: [
      { key:'tapeToTape',          label:'Tape-to-Tape Precision',    desc:'Accuracy of short, direct passes made to a teammate\'s stick blade along the ice.' },
      { key:'breakoutPass',        label:'Breakout Distance Pass',    desc:'Accuracy on long-range, zone-clearing vertical passes.' },
      { key:'saucerPass',          label:'Saucer Pass Altitude',      desc:'Ability to lift the puck over defender sticks and land it flat for clean reception.' },
      { key:'noLookPass',          label:'Blind/No-Look Delivery',    desc:'Passing accuracy when throwing to a teammate outside the player\'s direct line of sight.' },
    ],
  },
  puckHandling: {
    label: 'Puck Handling',
    subs: [
      { key:'tightSpaceStickhandling', label:'Tight-Space Stickhandling', desc:'Speed and control moving the puck in congested areas like the slot or boards.' },
      { key:'puckProtectionReach',     label:'Puck Protection Reach',     desc:'Maximum distance a player extends the puck to shield it from defender sticks.' },
      { key:'dekingDeception',         label:'Deking Deception',          desc:'Ability to execute head fakes and body shifts that trick goalies and defenders.' },
      { key:'badPassReception',        label:'Bad Pass Reception',        desc:'Success rate cleanly trapping bouncing or off-target passes without losing momentum.' },
    ],
  },
  offensiveIQ: {
    label: 'Offensive IQ',
    subs: [
      { key:'zoneEntryDecision',   label:'Zone Entry Decision Making', desc:'Speed identifying open lanes vs pressure when crossing the blue line.' },
      { key:'openIceAnticipation', label:'Open Ice Anticipation',      desc:'Reading the play and moving into vacant spaces before opponents can react.' },
      { key:'offPuckTiming',       label:'Off-Puck Run Timing',        desc:'Precision cutting toward the net or back-door lanes exactly when a passing window opens.' },
      { key:'cyclingPatience',     label:'Cycling Patience',           desc:'Capacity to protect the puck in the offensive zone while waiting for a defensive breakdown.' },
    ],
  },
  vision: {
    label: 'Vision',
    subs: [
      { key:'passingLaneID',       label:'Passing Lane Identification', desc:'Capacity to spot small, fleeting gaps between defender sticks and skates before they close.' },
      { key:'peripheralTracking',  label:'Peripheral Teammate Tracking',desc:'Awareness of trailing players or back-door cutters outside the player\'s direct forward view.' },
      { key:'defenderTracking',    label:'Defender Tracking',           desc:'Ability to map positions of all opposing players to avoid skating into a check.' },
      { key:'telegraphReduction',  label:'Telegraph Reduction',         desc:'Skill to mask intentions, preventing defenders from reading body language to intercept passes.' },
    ],
  },
  defensiveIQ: {
    label: 'Defensive IQ',
    subs: [
      { key:'passInterception',    label:'Pass Interception Tracking', desc:'Reading the opponent\'s eyes and stick blade to jump into passing lanes for a steal.' },
      { key:'rushAngleContain',    label:'Rush Angle Containment',     desc:'Calculating the perfect skating angle to force a rusher toward the boards.' },
      { key:'oddManDecision',      label:'Odd-Man Rush Decision Making',desc:'When to commit to the pass-receiver vs slide to take away the shooter on a 2-on-1.' },
      { key:'pressureTiming',      label:'Pressure Application Timing',desc:'Anticipating exactly when to step up for a pin versus back off into passive coverage.' },
    ],
  },
  positioning: {
    label: 'Positioning',
    subs: [
      { key:'netFrontCoverage',    label:'Net-Front Coverage',         desc:'Physically anchoring in front of the crease to tie up attackers and clear screens.' },
      { key:'gapControlDepth',     label:'Gap Control Depth',          desc:'Maintaining the perfect distance from the oncoming rusher to prevent breakaways.' },
      { key:'dzRotation',          label:'Defensive Zone Rotation',    desc:'Speed and accuracy of switching coverage duties with teammates when opponents cycle deeply.' },
      { key:'manMarking',          label:'Off-Puck Man-Marking',       desc:'Shadowing assignments in the defensive zone to prevent opponents breaking into open lanes.' },
    ],
  },
  stickChecking: {
    label: 'Stick Checking',
    subs: [
      { key:'pokeCheckAcc',        label:'Poke Check Accuracy',        desc:'Precision striking the puck cleanly away from an opponent\'s blade without tripping them.' },
      { key:'stickLiftTiming',     label:'Stick Lift Timing',          desc:'Quickness and leverage used to lift an opponent\'s stick right before a pass or shot.' },
      { key:'sweepCheckCoverage',  label:'Sweep Check Coverage',       desc:'Horizontal reach and effectiveness of waving the stick along the ice to deny passing lanes.' },
      { key:'stickDiscipline',     label:'Discipline Control',         desc:'Keeping the blade low, minimizing slashing or high-sticking penalties during battles.' },
    ],
  },
  shotBlocking: {
    label: 'Shot Blocking',
    subs: [
      { key:'laneCoverage',        label:'Lane Coverage Size',         desc:'Physical footprint and body extension achieved when dropping to block a shot path.' },
      { key:'dropTiming',          label:'Drop-to-Ice Timing',         desc:'Split-second execution of dropping into a block to avoid being faked by a shooter\'s hesitation.' },
      { key:'injuryResistance',    label:'Injury Resistance',          desc:'Physical durability to absorb high-velocity puck impacts without suffering injuries.' },
      { key:'deflectionControl',   label:'Deflection Control',         desc:'Angling the body or stick to direct blocked pucks into safe ice rather than creating rebounds.' },
    ],
  },
  faceoffs: {
    label: 'Faceoffs',
    subs: [
      { key:'gripTieUps',          label:'Grip Strength / Tie-Ups',   desc:'Physical leverage to lock up an opponent\'s stick and body, allowing a winger to claim the puck.' },
      { key:'quickDraw',           label:'Stick Speed / Quick Draws',  desc:'Reaction time and hand quickness to cleanly sweep the puck backward the instant it drops.' },
      { key:'counterMoveExec',     label:'Counter-Move Execution',    desc:'Tactical ability to read and defeat an opponent\'s specific chosen draw style.' },
      { key:'backhandSweep',       label:'Backhand Sweep Control',    desc:'Precision directing the won puck to a specific defenseman or open space using the backhand.' },
    ],
  },
  poise: {
    label: 'Poise',
    subs: [
      { key:'pressurePuckSecurity',label:'Pressure Puck Security',    desc:'Maintaining precise stickhandling control when cornered by multiple forecheckers.' },
      { key:'breakawayComposure',  label:'Breakaway Composure',       desc:'Maintaining high shooting accuracy and execution speed when racing alone against a goalie.' },
      { key:'clutchness',          label:'Late-Game Clutchness',      desc:'Resists performance drops during the final minutes of a close game or in overtime.' },
      { key:'pkDiscipline',        label:'Penalty-Kill Discipline',   desc:'Mental control to maintain strict defensive positioning and slow the game while shorthanded.' },
    ],
  },
  strength: {
    label: 'Strength',
    subs: [
      { key:'boardBattleLeverage', label:'Board Battle Leverage',     desc:'Lower-body power used to pin opponents or dig the puck loose along the boards.' },
      { key:'netFrontScreening',   label:'Net-Front Screening Power', desc:'Physical base required to anchor in front of the goalie or push defenders out of the crease.' },
      { key:'pushOffForce',        label:'Push-Off Force',            desc:'Upper-body strength used to shove defenders away and create separation while carrying the puck.' },
      { key:'stickLeverage',       label:'Stick-on-Stick Leverage',   desc:'Down-force pressure applied to overpower an opponent\'s stick during battles for loose pucks.' },
    ],
  },
  checking: {
    label: 'Checking',
    subs: [
      { key:'bodyCheckImpact',     label:'Body-Check Impact Force',   desc:'Raw physical power and momentum delivered into a hit to knock opponents off their feet.' },
      { key:'shoulderCheckAcc',    label:'Shoulder-Check Accuracy',   desc:'Alignment and timing to make clean, square contact with an opponent\'s torso at high speed.' },
      { key:'hipCheckTracking',    label:'Hip-Check Tracking',        desc:'Coordination to spin and lead with the hip to disrupt an attacker\'s rush lane along the boards.' },
      { key:'boardPinning',        label:'Board Pinning Effectiveness',desc:'Physically trapping an opponent against the boards without taking a holding penalty.' },
    ],
  },
  aggression: {
    label: 'Aggression',
    subs: [
      { key:'hitFrequency',        label:'Hit Completion Frequency',  desc:'Behavioral drive to finish every check and hunt down opponents even after the puck is released.' },
      { key:'cornerIntensity',     label:'Corner Battle Intensity',   desc:'Physical ferocity and relentless effort applied when fighting for loose pucks in high-traffic areas.' },
      { key:'intimidation',        label:'Intimidation Factor',       desc:'Psychological impact that causes opponents to suffer temporary drops in passing and shooting accuracy.' },
      { key:'scrumEngagement',     label:'Scrum Engagement',          desc:'Willingness to stick up for teammates, spark post-whistle altercations, or fight to shift momentum.' },
    ],
  },
  discipline: {
    label: 'Discipline',
    subs: [
      { key:'stickPenaltyAvoid',   label:'Stick Penalty Avoidance',   desc:'Spatial awareness to keep blades down, reducing high-sticking, slashing, or tripping calls.' },
      { key:'checkingControl',     label:'Checking Control',          desc:'Restraint to avoid launching upward or charging, preventing boarding or head-contact penalties.' },
      { key:'postWhistleRestraint',label:'Post-Whistle Restraint',    desc:'Emotional control to walk away from scrums and taunts without taking extra minors.' },
      { key:'embellishResist',     label:'Embellishment Resistance',  desc:'Integrity to play through minor hooks and holds without diving to draw calls.' },
    ],
  },
};

// Archetypes: deviations per attribute from base OVR
// Unlisted attributes = 0 deviation (stays at base OVR)
const SKATER_ARCHETYPES = {
  Sniper: {
    shootingAccuracy:+14, shotPower:+12, speed:+6, offensiveIQ:+5, puckHandling:+4,
    defensiveIQ:-12, stickChecking:-8, shotBlocking:-10, discipline:-4,
  },
  Playmaker: {
    passing:+14, vision:+12, offensiveIQ:+10, puckHandling:+8,
    shootingAccuracy:-8, shotPower:-10, strength:-4, checking:-4,
  },
  'Two-Way Forward': {
    offensiveIQ:+4, defensiveIQ:+4, passing:+3, shootingAccuracy:+2, poise:+3,
  },
  'Power Forward': {
    shotPower:+10, strength:+10, checking:+8, aggression:+8,
    agility:-6, acceleration:-4, puckHandling:-6, discipline:-4,
  },
  'Defensive Forward': {
    defensiveIQ:+12, stickChecking:+10, shotBlocking:+8, faceoffs:+8, poise:+6, positioning:+4,
    shootingAccuracy:-10, shotPower:-8, vision:-4,
  },
  Grinder: {
    endurance:+10, strength:+12, checking:+15, faceoffs:+8, aggression:+16,
    shootingAccuracy:-18, shotPower:-14, vision:-16, puckHandling:-14, offensiveIQ:-12,
  },
  Enforcer: {
    strength:+16, checking:+14, aggression:+14, intimidation:+10,
    shootingAccuracy:-14, vision:-10, passing:-8, agility:-6,
  },
  'Offensive D': {
    passing:+12, vision:+10, offensiveIQ:+10, speed:+6, puckHandling:+6,
    shotBlocking:-8, strength:-4, checking:-4, positioning:-3,
  },
  'Shutdown D': {
    defensiveIQ:+14, positioning:+12, strength:+10, shotBlocking:+8, stickChecking:+8, poise:+4,
    shootingAccuracy:-12, offensiveIQ:-8, puckHandling:-6, speed:-4,
  },
  'Two-Way D': {
    defensiveIQ:+6, positioning:+6, passing:+4, offensiveIQ:+4, poise:+3,
  },
};

// Position → available archetypes
const POS_ARCHETYPES = {
  C:  ['Sniper','Playmaker','Two-Way Forward','Power Forward','Defensive Forward','Grinder'],
  LW: ['Sniper','Playmaker','Two-Way Forward','Power Forward','Defensive Forward','Grinder','Enforcer'],
  RW: ['Sniper','Playmaker','Two-Way Forward','Power Forward','Defensive Forward','Grinder','Enforcer'],
  LD: ['Offensive D','Shutdown D','Two-Way D'],
  RD: ['Offensive D','Shutdown D','Two-Way D'],
};

// Position-specific OVR weight per attribute group
// Weights must sum to 1.0 per position
const OVR_WEIGHTS = {
  C:  { speed:0.06, acceleration:0.04, agility:0.04, balance:0.03, endurance:0.03,
        shootingAccuracy:0.07, shotPower:0.05, passing:0.07, puckHandling:0.05, offensiveIQ:0.07, vision:0.06,
        defensiveIQ:0.06, positioning:0.04, stickChecking:0.04, shotBlocking:0.02, faceoffs:0.06, poise:0.04,
        strength:0.03, checking:0.03, aggression:0.02, discipline:0.04 },
  LW: { speed:0.07, acceleration:0.05, agility:0.05, balance:0.03, endurance:0.03,
        shootingAccuracy:0.09, shotPower:0.08, passing:0.06, puckHandling:0.06, offensiveIQ:0.07, vision:0.05,
        defensiveIQ:0.04, positioning:0.03, stickChecking:0.03, shotBlocking:0.02, faceoffs:0.01, poise:0.03,
        strength:0.04, checking:0.04, aggression:0.03, discipline:0.03 },
  RW: { speed:0.07, acceleration:0.05, agility:0.05, balance:0.03, endurance:0.03,
        shootingAccuracy:0.09, shotPower:0.08, passing:0.06, puckHandling:0.06, offensiveIQ:0.07, vision:0.05,
        defensiveIQ:0.04, positioning:0.03, stickChecking:0.03, shotBlocking:0.02, faceoffs:0.01, poise:0.03,
        strength:0.04, checking:0.04, aggression:0.03, discipline:0.03 },
  LD: { speed:0.05, acceleration:0.04, agility:0.04, balance:0.04, endurance:0.04,
        shootingAccuracy:0.03, shotPower:0.04, passing:0.07, puckHandling:0.04, offensiveIQ:0.04, vision:0.05,
        defensiveIQ:0.09, positioning:0.08, stickChecking:0.06, shotBlocking:0.07, faceoffs:0.02, poise:0.06,
        strength:0.06, checking:0.05, aggression:0.02, discipline:0.05 },
  RD: { speed:0.05, acceleration:0.04, agility:0.04, balance:0.04, endurance:0.04,
        shootingAccuracy:0.03, shotPower:0.04, passing:0.07, puckHandling:0.04, offensiveIQ:0.04, vision:0.05,
        defensiveIQ:0.09, positioning:0.08, stickChecking:0.06, shotBlocking:0.07, faceoffs:0.02, poise:0.06,
        strength:0.06, checking:0.05, aggression:0.02, discipline:0.05 },
};

// ----------------------------------------------------------------
// UNIFIED GOALIE ATTRIBUTE SYSTEM — 17 attributes across 4 groups
// ----------------------------------------------------------------
const GOALIE_ATTR_KEYS = [
  // Athleticism (4)
  'reflexes','agility','recovery','endurance',
  // Technical (5)
  'positioning','angles','reboundControl','gloveStick','puckTracking',
  // Mental (3)
  'poise','anticipation','consistency',
  // Physical (3)
  'strength','aggression','durability',
];

// Archetypes: deviations per attribute from base OVR
const GOALIE_ARCHETYPES = {
  'Butterfly': {
    positioning:+14, angles:+12, reboundControl:+10, poise:+6,
    reflexes:-4, agility:-8, recovery:-6,
  },
  'Athletic': {
    reflexes:+14, agility:+12, recovery:+10, strength:+6,
    positioning:-6, reboundControl:-8, poise:-4,
  },
  'Hybrid': {
    positioning:+6, reflexes:+6, poise:+4, angles:+4,
  },
  'Puck-Handler': {
    gloveStick:+16, puckTracking:+12, agility:+6, anticipation:+6,
    reboundControl:-6, strength:-4,
  },
  'Scrambler': {
    reflexes:+12, recovery:+12, aggression:+8, durability:+6,
    positioning:-10, angles:-8, consistency:-8,
  },
};

// OVR weights for goalies
const GOALIE_OVR_WEIGHTS = {
  reflexes:0.10, agility:0.06, recovery:0.06, endurance:0.04,
  positioning:0.12, angles:0.10, reboundControl:0.08, gloveStick:0.10, puckTracking:0.07,
  poise:0.08, anticipation:0.07, consistency:0.08,
  strength:0.03, aggression:0.02, durability:0.04,
};

// ----------------------------------------------------------------
// GOALIE SUB-ATTRIBUTE SYSTEM
// 3 sub-attributes per parent skill — same structure as skaters.
// Sub keys are used for display/flavor; parent skill is the stored value.
// ----------------------------------------------------------------
const GOALIE_ATTR_SUBS = {
  // ── ATHLETICISM ───────────────────────────────────────────────
  reflexes: {
    label: 'Reflexes',
    subs: [
      { key:'highVelocityReaction',       label:'High-Velocity Reaction',       desc:'Speed of response against pure power shots — getting the paddle or glove on a slap shot before it crosses the line.' },
      { key:'changeOfDirectionResponse',  label:'Change-of-Direction Response', desc:'Reaction to deflections or pucks that hit bodies and change trajectory unpredictably in front of the net.' },
      { key:'closeRangeTwitch',           label:'Close-Range Twitch',           desc:'Micro-movements for pucks already inside the crease — the twitchy last-ditch adjustments that stop tap-ins.' },
    ],
  },
  agility: {
    label: 'Agility',
    subs: [
      { key:'lateralPowerSlide',  label:'Lateral Power-Slide',  desc:'Explosive crossover movement across the Royal Road to cut off one-timers from the back door.' },
      { key:'creaseShuffling',    label:'Crease Shuffling',      desc:'Small, precise shuffling steps to stay perfectly centered on the puck without over-committing laterally.' },
      { key:'tPushEfficiency',    label:'T-Push Efficiency',     desc:'The speed and cleanness of the reset push off the post after a lateral move — how quickly the goalie is back in position.' },
    ],
  },
  recovery: {
    label: 'Recovery',
    subs: [
      { key:'postToFeetTransition', label:'Post-to-Feet Transition', desc:'Speed of rising from a butterfly or sprawl back to a standing stance before the next shot arrives.' },
      { key:'desperationReach',     label:'Desperation Reach',       desc:'The save-of-the-year attribute — the ability to extend a limb beyond the normal body frame in a last-ditch effort.' },
      { key:'secondSaveReadiness',  label:'Second-Save Readiness',   desc:'How quickly the goalie resets vision and body position after giving up a rebound, ready for the follow-up shot.' },
    ],
  },
  endurance: {
    label: 'Endurance',
    subs: [
      { key:'heavyVolumeStamina',   label:'Heavy-Volume Stamina',    desc:'Resilience against games with high shot counts — maintaining peak save percentage late in a 40-shot barrage.' },
      { key:'recoveryRate',         label:'Recovery Rate',           desc:'Stamina regained during stoppages, icings, and intermissions — how fresh the goalie feels at the start of each period.' },
      { key:'fatigueFormRetention', label:'Fatigue Form Retention',  desc:'Resistance to breaking down technically when tired — avoiding early drops, overcommitting, or poor angle reads.' },
    ],
  },
  // ── TECHNICAL ─────────────────────────────────────────────────
  positioning: {
    label: 'Positioning',
    subs: [
      { key:'depthAggression',      label:'Depth Aggression',          desc:'How aggressively the goalie challenges the shooter — cutting down angle by playing further out of the crease.' },
      { key:'postIntegration',      label:'Post-Integration (RVH/VH)', desc:'Efficiency of sealing the post using the reverse-VH or VH stance, closing the short side against back-door plays.' },
      { key:'fiveHoleClosure',      label:'Five-Hole Closure',         desc:'Speed and tightness of the leg pad seal in the butterfly — preventing pucks from sneaking through the five-hole.' },
    ],
  },
  angles: {
    label: 'Angles',
    subs: [
      { key:'centerLineAlignment',  label:'Center-Line Alignment',  desc:'Ability to keep the "logo" — the center of the body — directly on the puck at all times during active play.' },
      { key:'gapClosure',           label:'Gap Closure',            desc:'Shrinking the shootable net by skating out toward the puck carrier as they approach, reducing available target.' },
      { key:'squarenessRecovery',   label:'Squareness Recovery',    desc:'Speed of correcting the body angle after a lateral pass or seam entry forces the goalie off their original tracking line.' },
    ],
  },
  reboundControl: {
    label: 'Rebound Control',
    subs: [
      { key:'kickDirection',        label:'Kick Direction',      desc:'Precision in steering shot rebounds to the corners with the pad — denying second opportunities by directing pucks away from danger.' },
      { key:'chestAbsorption',      label:'Chest Absorption',    desc:'Ability to deaden shots into the chest protector and jersey, smothering the puck for a whistle rather than creating a rebound.' },
      { key:'blockerSteering',      label:'Blocker Steering',    desc:'Power and directional aim when punching pucks into the corners with the blocker hand rather than letting them drop in front.' },
    ],
  },
  gloveStick: {
    label: 'Glove & Stick',
    subs: [
      { key:'gloveHighLow',         label:'Glove High/Low',      desc:'Range and reliability of the catching glove both above the shoulder on high shots and down near the ice on low redirects.' },
      { key:'activePokCheck',       label:'Active Poke Check',   desc:'The ability and timing to thrust the stick out and disrupt a deke or poke the puck free before the attacker can shoot.' },
      { key:'stickClearing',        label:'Stick Clearing',      desc:'Accuracy and power when passing or rimming the puck around the boards — enabling clean breakouts and killing icing calls.' },
    ],
  },
  puckTracking: {
    label: 'Puck Tracking',
    subs: [
      { key:'screenNavigation',     label:'Screen Navigation',    desc:'Ability to see through bodies and sticks planted in front of the crease — finding the puck despite net-front traffic.' },
      { key:'aerialTracking',       label:'Aerial Tracking',      desc:'Reading pucks elevated in the air from saucer passes or rim attempts and adjusting position before they land.' },
      { key:'lowToHighTracking',    label:'Low-to-High Tracking', desc:'Adjusting vision when the puck moves from below or behind the net up to the point — a common source of "lost sight" goals.' },
    ],
  },
  // ── MENTAL ────────────────────────────────────────────────────
  poise: {
    label: 'Poise',
    subs: [
      { key:'panicManagement',      label:'Panic Management',      desc:'Staying in structured position during chaotic crease scrambles rather than flailing or swimming out of the net.' },
      { key:'breakawayComposure',   label:'Breakaway Composure',   desc:'Resisting pump fakes and body shifts during 1-on-1 breakaways — holding position until the puck is actually released.' },
      { key:'lateGameFocus',        label:'Late-Game Focus',       desc:'Maintaining technical stability in high-leverage moments — protecting a lead or keeping a team in a game.' },
    ],
  },
  anticipation: {
    label: 'Anticipation',
    subs: [
      { key:'passToShotReading',    label:'Pass-to-Shot Reading',  desc:'Predicting whether the puck carrier will pass or shoot — staying set rather than committing to the wrong movement.' },
      { key:'backDoorAwareness',    label:'Back-Door Awareness',   desc:'Tracking the non-puck carrier in the slot or back door so a cross-crease pass does not catch the goalie flat-footed.' },
      { key:'biteResistance',       label:'Bite Resistance',       desc:'Mental discipline to not react to head fakes or pump fakes — waiting for the actual shot before committing.' },
    ],
  },
  consistency: {
    label: 'Consistency',
    subs: [
      { key:'softGoalFrequency',    label:'"Soft Goal" Frequency', desc:'Inverse probability of allowing a low-danger goal — how often the goalie surrenders a shot they should have stopped.' },
      { key:'hotColdStreaks',       label:'Hot/Cold Streaks',      desc:'How strongly recent save results influence the current flow state — high values mean bigger momentum swings both ways.' },
    ],
  },
  // ── PHYSICAL ──────────────────────────────────────────────────
  strength: {
    label: 'Strength',
    subs: [
      { key:'creaseIntegrity',      label:'Crease Integrity',      desc:'Resistance to being bodied or pushed out of position by attackers camping in the crease — holding ground under physical pressure.' },
      { key:'butterflySeal',         label:'Butterfly Seal',         desc:'Lower-body strength to keep both pads flat and sealed to the ice in the butterfly so pucks cannot squeeze through the five-hole.' },
    ],
  },
  aggression: {
    label: 'Aggression',
    subs: [
      { key:'challengeDistance',     label:'Challenge Distance',     desc:'Behavioral drive to play aggressively outside the crease paint — cutting down angle by challenging shooters further from the net.' },
      { key:'physicalEngagement',    label:'Physical Engagement',    desc:'Willingness to throw a soft slash or shove an attacker in the crease to regain positioning without drawing a penalty.' },
    ],
  },
  durability: {
    label: 'Durability',
    subs: [
      { key:'lowerBodyHealth',       label:'Lower-Body Health',       desc:'Resistance to groin and hip injuries from repeated butterfly drops and extreme lateral stretches across the crease.' },
      { key:'collisionAbsorption',   label:'Collision Absorption',   desc:'Ability to absorb and withstand impact when a skater crashes the net at full speed without sustaining a serious injury.' },
    ],
  },
};

// Pick archetype based on position
function pickArchetype(pos){
  if(pos === 'G') return pick(Object.keys(GOALIE_ARCHETYPES));
  const options = POS_ARCHETYPES[pos] || ['Two-Way Forward'];
  return pick(options);
}

// Generate attributes from a target OVR and archetype weights
function genAttributes(pos, targetOVR, archetype){
  // Attribute generation: archetype creates asymmetry, not inflation.
  // A sniper's shooting might be 10pts above OVR but defense 10 below — avg stays near OVR.
  if(pos === 'G'){
    const deviations = GOALIE_ARCHETYPES[archetype] || {};
    const attrs = {};
    GOALIE_ATTR_KEYS.forEach(k => {
      const dev = deviations[k] || 0;
      const base = targetOVR + dev + rnd(-4, 4);
      attrs[k] = Math.min(99, Math.max(40, Math.round(base)));
    });
    // Generate sub-attributes for skills that have them defined
    Object.entries(GOALIE_ATTR_SUBS).forEach(([skillKey, skillMeta]) => {
      const parentVal = attrs[skillKey] || targetOVR;
      skillMeta.subs.forEach(sub => {
        const subVal = parentVal + rnd(-6, 6);
        attrs[sub.key] = Math.min(99, Math.max(40, Math.round(subVal)));
      });
      // Recalculate parent as average of its subs
      const avg = Math.round(skillMeta.subs.reduce((s, sub) => s + attrs[sub.key], 0) / skillMeta.subs.length);
      attrs[skillKey] = Math.min(99, Math.max(40, avg));
    });
    return attrs;
  } else {
    const deviations = SKATER_ARCHETYPES[archetype] || {};
    const attrs = {};
    // Generate 21 parent skill ratings
    SKATER_ATTR_KEYS.forEach(k => {
      const dev = deviations[k] || 0;
      const base = targetOVR + dev + rnd(-4, 4);
      attrs[k] = Math.min(99, Math.max(40, Math.round(base)));
    });
    // Generate sub-attribute values derived from parent skill +/- variance.
    // Sub-skills now DRIVE their parent: after generation, each parent skill is
    // recalculated as the average of its 4 subs so they stay consistent.
    Object.entries(SKATER_ATTR_SUBS).forEach(([skillKey, skillMeta]) => {
      const parentVal = attrs[skillKey] || targetOVR;
      skillMeta.subs.forEach(sub => {
        const subVal = parentVal + rnd(-6, 6);
        attrs[sub.key] = Math.min(99, Math.max(40, Math.round(subVal)));
      });
      // Recalculate parent as average of its subs (keeps them in sync from birth)
      const avg = Math.round(skillMeta.subs.reduce((s, sub) => s + attrs[sub.key], 0) / skillMeta.subs.length);
      attrs[skillKey] = Math.min(99, Math.max(40, avg));
    });
    return attrs;
  }
}

// Calculate OVR from attributes (keeps p.ovr consistent)
function calcOVR(attrs, pos){
  if(!attrs) return 80;
  if(pos === 'G'){
    let total = 0;
    GOALIE_ATTR_KEYS.forEach(k => {
      total += (attrs[k] || 70) * (GOALIE_OVR_WEIGHTS[k] || 0);
    });
    return Math.min(99, Math.max(40, Math.round(total)));
  } else {
    const weights = OVR_WEIGHTS[pos] || OVR_WEIGHTS['C'];
    let total = 0;
    SKATER_ATTR_KEYS.forEach(k => {
      total += (attrs[k] || 70) * (weights[k] || 0);
    });
    return Math.min(99, Math.max(40, Math.round(total)));
  }
}

// Attribute label colors
function attrColor(val){
  if(val >= 90) return '#5dade2';
  if(val >= 80) return '#2ecc71';
  if(val >= 70) return 'var(--ice)';
  return 'var(--red2)';
}

function newPlayer(pos, ovr, age){
  const targetOvr = ovr;
  // Step 1: determine target OVR — realistic distribution
  if(!ovr){
    pos = pos || pick(POSITIONS);
    if(pos === 'G'){
      const roll = rnd(1,100);
      if(roll <= 1)        ovr = rnd(93,97);   // generational — extremely rare
      else if(roll <= 5)   ovr = rnd(89,93);   // elite starter
      else if(roll <= 35)  ovr = rnd(84,89);   // NHL starter band
      else if(roll <= 72)  ovr = rnd(80,84);   // backup / platoon
      else                 ovr = rnd(76,80);   // depth
    } else {
      const roll = rnd(1,100);
      if(roll <= 20)      ovr = rnd(76,80);  // depth/bottom-6 (20%)
      else if(roll <= 55) ovr = rnd(80,84);  // middle tier (35%)
      else if(roll <= 80) ovr = rnd(84,87);  // solid starters (25%)
      else if(roll <= 92) ovr = rnd(87,91);  // stars (12%)
      else if(roll <= 97) ovr = rnd(91,94);  // elite (5%)
      else                ovr = rnd(94,97);  // franchise (3%)
    }
  } else {
    pos = pos || pick(POSITIONS);
  }
  age = age || rnd(20,35);

  // Step 2: pick archetype and generate attributes from target OVR
  const archetype = pickArchetype(pos);
  const attrs = genAttributes(pos, ovr, archetype);

  // Step 3: derive OVR from attributes (single source of truth)
  ovr = calcOVR(attrs, pos);
  // Clamp all positions to ±3 of target — prevents attribute variance
  // from producing wildly off-target overalls (e.g. 3x 95-OVR defensemen)
  if(typeof targetOvr === 'number'){
    ovr = Math.min(Math.min(99, targetOvr + 3), Math.max(Math.max(40, targetOvr - 3), ovr));
  }
  // Hard floor: NHL roster players never generate below 76
  // (FA and prospect generation use separate functions with their own floors)
  if(targetOvr != null && targetOvr >= 76) ovr = Math.max(76, ovr);

  const sal = Math.max(0.5, salFromOVR(ovr));
  const finalSal = Math.max(league.minSalary, sal);
  const finalPct = salaryToCapPct(finalSal);

  // Players under 25 get developmental traits just like draftees
  let devVariance = null;
  let isDraftee = false;
  let trueGrade = null;
  let gradeRevealed = false;
  if(age < 25){
    devVariance = generateDevProfile();
    isDraftee = false; // they weren't drafted by the user, but still have dev traits
    // Ceiling is a bit above current OVR (already developed partially)
    const trueCeilOVR = Math.min(99, ovr + rnd(2, 12));
    trueGrade = potentialGrade(trueCeilOVR);
    gradeRevealed = true; // generated roster players' grades visible to scouts (they're known quantities)
  }

  // Veteran players (26+) have accumulated career NHL GP beyond the exemption threshold.
  // Young players (< 25) start with 0 GP and earn exemption loss through play.
  // This ensures veterans immediately go through waivers when cut, as in real NHL.
  const gpThresh = pos === 'G' ? 20 : 30; // matches WAIVER_EXEMPT thresholds
  const nhlGamesPlayed = age >= 26 ? gpThresh + rnd(10, 200) : 0;

  return {
    id: Math.random().toString(36).slice(2,9),
    name: pname(), pos, ovr, age,
    salary: finalSal, capPct: finalPct,
    years: contractYears(ovr, age),
    archetype, attrs,
    stats: freshStats(pos),
    seasonHistory: [],
    careerTotals: freshCareerTotals(pos),
    devVariance,
    isDraftee,
    trueGrade,
    gradeRevealed,
    nhlGamesPlayed,
  };
}

function newGoalie(role){
  const roll = rnd(1,100);
  let target;
  if(role === 'starter'){
    // Hard league-wide scarcity: very few 90+ and 88+ masks after attribute roll
    if(leagueGoalies90PlusCount < 2 && roll <= 1){
      target = rnd(91, 94);
    } else if(leagueGoalies90PlusCount < 2 && roll <= 3){
      target = rnd(88, 90);
    } else if(leagueGoalies88PlusCount < 8 && roll <= 14){
      target = rnd(85, 88);
    } else if(roll <= 52){
      target = rnd(81, 85);
    } else {
      target = rnd(76, 81);
    }
  } else if(role === 'backup'){
    if(roll <= 8) target = rnd(78, 81);
    else          target = rnd(76, 78);
  } else {
    target = rnd(76, 79);
  }
  const p = newPlayer('G', target);
  if(p.ovr >= 90) leagueGoalies90PlusCount++;
  if(p.ovr >= 88) leagueGoalies88PlusCount++;
  return p;
}

function newTeam(name) {
  const roster = [];
  // 1. Get team identity from TEAM_DATA (default to Balanced if not found)
  const info = TEAM_DATA[name] || { philCode: 'B' };
  const phil = info.philCode;

// 2. Select the Forward Tiers based on Identity
  // We use offensiveFwdTiers as the "default" if no other match is found
  let selectedFwdTiers = offensiveFwdTiers; 
  
  if (phil === 'R') {
    selectedFwdTiers = rebuildingFwdTiers;
  } else if (phil === 'O') {
    selectedFwdTiers = offensiveFwdTiers;
  } else if (phil === 'D') {
    selectedFwdTiers = defensiveFwdTiers;
  } else {
    // This is for "Balanced" teams - they get a mix of top-end talent
    selectedFwdTiers = offensiveFwdTiers; 
  }
  const fwdPositions = ['C','C','C','C','LW','LW','LW','LW','RW','RW','RW','RW'];
  // Shuffle positions
  for(let i=fwdPositions.length-1; i>0; i--){
    const j = rnd(0,i);
    [fwdPositions[i], fwdPositions[j]] = [fwdPositions[j], fwdPositions[i]];
  }

  // Create Forwards using the selected tier list
  selectedFwdTiers.forEach(([oMin, oMax, aMin, aMax], i) => {
    roster.push(newPlayer(fwdPositions[i], rnd(oMin, oMax), rnd(aMin, aMax)));
  });

  // Add 13th forward (4th-line center/winger) — all NHL teams carry one
  const extra13thPos = pick(['C','LW','RW']);
  roster.push(newPlayer(extra13thPos, rnd(76, 79), rnd(22, 32)));

  // 3. Select/Adjust Defense Tiers based on Identity
  let selectedDefTiers = [
    [84, 89, 22, 32], [81, 84, 22, 33], [79, 82, 23, 33],
    [78, 81, 24, 34], [77, 80, 24, 35], [76, 79, 19, 35]
  ];

  if (phil === 'R') {
    // Rebuilding defense is weaker and younger
    selectedDefTiers = [
      [81, 84, 20, 24], [79, 82, 20, 25], [78, 81, 21, 26],
      [77, 80, 22, 27], [76, 79, 23, 28], [76, 78, 20, 31]
    ];
  } else if (phil === 'D') {
    // Defensive teams get a slight boost to their Top 4 D
    selectedDefTiers[0] = [87, 92, 24, 32];
    selectedDefTiers[1] = [84, 87, 24, 32];
  }

  const defPositions = ['LD','RD','LD','RD','LD','RD'];
  selectedDefTiers.forEach(([oMin, oMax, aMin, aMax], i) => {
    roster.push(newPlayer(defPositions[i], rnd(oMin, oMax), rnd(aMin, aMax)));
  });

  // 4. Goalies
  if (phil === 'R') {
    roster.push(newPlayer('G', rnd(78, 82), rnd(20, 25))); // Weak young starter
    roster.push(newPlayer('G', rnd(76, 79), rnd(20, 35))); // Backup
  } else {
    roster.push(newGoalie('starter'));
    roster.push(newGoalie('backup'));
  }
  roster.push(newGoalie('depth'));

  // Build CPU affiliate rosters with prospects
  const cpuAHL = { roster: [] };
  const cpuECHL = { roster: [] };
  const ahlCount = rnd(5, 8);
  const echlCount = rnd(4, 7);
  for(let i = 0; i < ahlCount; i++){
    const p = newProspect(rnd(2, 5), 1.0);
    p.isELC = true; p.salary = ELC.maxSalary; p.years = rnd(1, 3);
    p._affiliate = 'cpuAHL';
    cpuAHL.roster.push(p);
  }
  for(let i = 0; i < echlCount; i++){
    const p = newProspect(rnd(4, 7), 1.0);
    p.isELC = true; p.salary = ELC.maxSalary; p.years = rnd(1, 2);
    p._affiliate = 'cpuECHL';
    cpuECHL.roster.push(p);
  }

  return { name, w: 0, l: 0, otl: 0, roster, cpuAHL, cpuECHL };
}

function teamOVR(roster){
  if(!roster.length) return 0;
  return Math.round(roster.reduce((s,p) => s+p.ovr, 0) / roster.length);
}

function capUsed(){
  if(!state||!state.myTeam) return 0;
  // NHL roster: always count at full salary
  const nhlCap = state.myTeam.roster.reduce((s,p) => s + (p.nhlSalary || p.salary), 0);
  // Minor leaguers:
  //   - ELC players: $0 cap hit while in minors
  //   - Two-way contracts: count at their minor salary
  //   - One-way contracts: count at full NHL salary even in minors
  const minorCap = [...(state.ahl?.roster||[]), ...(state.echl?.roster||[])].reduce((s,p) => {
    if(p.isELC) return s;
    if(p.isTwoWay) return s + (p.minorSalary || p.salary);
    return s + (p.nhlSalary || p.salary);
  }, 0);
  // Retained salary on traded-away players still counts against our cap
  const retainedCap = (state.myTeam.retainedContracts||[]).reduce((s,r) => s + (r.amt||0), 0);
  return nhlCap + minorCap + retainedCap;
}
function capLeft(){ return BUDGET - capUsed(); }

// ---- Salary Floor System ----
// Calculate a team's total payroll in $M
// Retained salary on traded-away players counts toward the floor (you're still paying it)
function teamPayroll(team){
  if(!team || !team.roster) return 0;
  const rosterPay = team.roster.reduce((s, p) => s + (p.salary || 0), 0);
  const retainedPay = (team.retainedContracts||[]).reduce((s, r) => s + (r.amt||0), 0);
  return rosterPay + retainedPay;
}

// Calculate a team's total payroll as cap percentage
function teamPayrollPct(team){
  return Math.round(teamPayroll(team) / league.salaryCap * 1000) / 10;
}

// Check if a team is below the salary floor
function isBelowFloor(team){
  return teamPayroll(team) < league.capFloor;
}

// How much a team needs to spend to reach the floor (in $M)
function floorDeficit(team){
  return Math.max(0, Math.round((league.capFloor - teamPayroll(team)) * 100) / 100);
}

// Validate all teams before season starts — log warnings
function validateSalaryFloors(){
  let violations = 0;
  allTeams().forEach(team => {
    const pct = teamPayrollPct(team);
    if(isBelowFloor(team)){
      const deficit = floorDeficit(team);
      console.warn(`[Salary Floor] ${team.name} is BELOW the floor at ${pct}% ($${teamPayroll(team).toFixed(1)}M) — needs $${deficit.toFixed(1)}M more`);
      violations++;
    } else {
      console.log(`[Salary Floor] ${team.name} OK at ${pct}% ($${teamPayroll(team).toFixed(1)}M)`);
    }
  });
  if(violations > 0){
    console.warn(`[Salary Floor] ${violations} team(s) below the floor of ${league.capFloorPct}% ($${league.capFloor.toFixed(1)}M)`);
  }
  return violations;
}

// AI: if a team is below the floor, sign cheap FAs until they're compliant
// Apply a proportional salary bump to every player so the team hits the cap floor.
// This mirrors real NHL rules: when a team misses the floor, every player's cap hit
// is prorated upward. The bump is stored in p._floorAdj (added on top of p.salary)
// and cleared when a real signing/trade changes the roster.
function applyFloorAdjustment(team){
  if(!isBelowFloor(team)) return;

  const currentPayroll = teamPayroll(team);
  if(currentPayroll <= 0) return;

  const deficit = league.capFloor - currentPayroll;

  // Distribute deficit proportionally — higher-paid players absorb more
  team.roster.forEach(p => {
    const share = (p.salary / currentPayroll) * deficit;
    const bump = Math.round(share * 1000) / 1000; // round to $1K
    p._floorAdj = bump;
    p.salary = Math.round((p.salary + bump) * 1000) / 1000;
    p.capPct = salaryToCapPct(p.salary);
    if(!p._preFloorSalary) p._preFloorSalary = p.salary - bump; // store original for rollback
  });

  const newPayroll = teamPayroll(team);
  console.log(
    `[Cap Floor] ${team.name} bumped from $${currentPayroll.toFixed(2)}M → $${newPayroll.toFixed(2)}M ` +
    `(+$${deficit.toFixed(2)}M distributed across ${team.roster.length} players)`
  );
}

// Rollback floor adjustments — restores original salaries before a new signing/trade
function clearFloorAdjustments(team){
  if(!team || !team.roster) return;
  team.roster.forEach(p => {
    if(p._floorAdj && p._preFloorSalary != null){
      p.salary = p._preFloorSalary;
      p.capPct = salaryToCapPct(p.salary);
    }
    delete p._floorAdj;
    delete p._preFloorSalary;
  });
}

// ---- US City Pool ----
const US_CITIES = [
  'Abilene','Akron','Albany','Albuquerque','Alexandria','Allentown','Amarillo','Anaheim',
  'Anchorage','Ann Arbor','Antioch','Appleton','Arlington','Arvada','Asheville','Athens',
  'Atlanta','Atlantic City','Augusta','Aurora','Austin','Bakersfield','Baltimore','Baton Rouge',
  'Beaumont','Bellevue','Berkeley','Billings','Biloxi','Binghamton','Birmingham','Bismarck',
  'Bloomington','Boca Raton','Boise','Boston','Boulder','Bowling Green','Bradenton','Bridgeport',
  'Brockton','Brownsville','Buffalo','Burbank','Burlington','Cambridge','Camden','Canton',
  'Cape Coral','Carlsbad','Carson City','Cary','Casper','Cedar Rapids','Chandler','Charleston',
  'Charlotte','Charlottesville','Chattanooga','Chesapeake','Cheyenne','Chicago','Chico',
  'Chula Vista','Cincinnati','Clarksville','Clearwater','Cleveland','Clovis','College Station',
  'Colorado Springs','Columbia','Columbus','Concord','Coral Gables','Corona','Corpus Christi',
  'Costa Mesa','Council Bluffs','Cranston','Cupertino','Dallas','Daly City','Danbury',
  'Davenport','Dayton','Daytona Beach','Dearborn','Decatur','Denton','Denver','Des Moines',
  'Detroit','Dover','Dubuque','Duluth','Durham','Edison','El Paso','Elgin','Elizabeth',
  'Elkhart','Elko','Elmira','Erie','Escondido','Eugene','Evanston','Evansville','Everett',
  'Fairbanks','Fairfield','Fargo','Fayetteville','Flagstaff','Flint','Fontana','Fort Collins',
  'Fort Lauderdale','Fort Myers','Fort Smith','Fort Wayne','Fort Worth','Fremont','Fresno',
  'Frisco','Fullerton','Gainesville','Galveston','Garden Grove','Garland','Gary','Gastonia',
  'Gilbert','Glendale','Grand Forks','Grand Rapids','Green Bay','Greensboro','Greenville',
  'Gulfport','Hampton','Hartford','Hattiesburg','Hayward','Helena','Henderson','Hialeah',
  'Hollywood','Honolulu','Houston','Huntington','Huntsville','Independence','Indianapolis',
  'Inglewood','Irvine','Irving','Jackson','Jacksonville','Jefferson City','Jersey City',
  'Joliet','Juneau','Kalamazoo','Kansas City','Kenosha','Killeen','Knoxville','Kokomo',
  'La Crosse','Lafayette','Laguna Niguel','Lake Charles','Lakeland','Lakewood','Lancaster',
  'Lansing','Laredo','Las Cruces','Las Vegas','Lawrence','Lawton','Layton','Lewisville',
  'Lexington','Lima','Lincoln','Little Rock','Livermore','Livonia','Long Beach','Longview',
  'Los Angeles','Louisville','Lowell','Lubbock','Lynchburg','Macon','Madison','Manchester',
  'Marietta','McAllen','McKinney','Medford','Melbourne','Memphis','Merced','Mesa','Mesquite',
  'Miami','Midland','Milwaukee','Minneapolis','Minot','Mobile','Modesto','Moline','Montgomery',
  'Moorhead','Murfreesboro','Muskegon','Napa','Naperville','Nashua','Nashville','New Bedford',
  'New Britain','New Haven','New Orleans','New York','Newark','Newport News','Newton','Norfolk',
  'Norman','North Las Vegas','Norwalk','Oakland','Ocala','Oceanside','Odessa','Ogden',
  'Oklahoma City','Olympia','Omaha','Ontario','Orange','Orlando','Overland Park','Oxnard',
  'Palmdale','Palo Alto','Panama City','Pasadena','Paterson','Pawtucket','Pensacola','Peoria',
  'Philadelphia','Phoenix','Pittsburgh','Plano','Pompano Beach','Pontiac','Portland','Portsmouth',
  'Poughkeepsie','Providence','Provo','Pueblo','Quincy','Racine','Raleigh','Rancho Cucamonga',
  'Rapid City','Reading','Redding','Redmond','Reno','Renton','Rialto','Richardson','Richmond',
  'Riverside','Roanoke','Rochester','Rockford','Rock Hill','Roseville','Roswell','Sacramento',
  'Saginaw','Saint Paul','Salem','Salinas','Salt Lake City','San Angelo','San Antonio',
  'San Bernardino','San Diego','San Francisco','San Jose','San Mateo','Santa Ana','Santa Barbara',
  'Santa Clara','Santa Clarita','Santa Cruz','Santa Fe','Santa Monica','Santa Rosa','Sarasota',
  'Savannah','Schaumburg','Schenectady','Scranton','Scottsdale','Seattle','Shreveport',
  'Simi Valley','Sioux City','Sioux Falls','South Bend','Spartanburg','Spokane','Springfield',
  'St. Augustine','St. Cloud','St. George','St. Louis','St. Petersburg','Stamford',
  'Sterling Heights','Stockton','Sunnyvale','Syracuse','Tacoma','Tallahassee','Tampa',
  'Temecula','Tempe','Terre Haute','Texarkana','Thousand Oaks','Toledo','Topeka','Torrance',
  'Trenton','Troy','Tucson','Tulsa','Tuscaloosa','Tyler','Utica','Valdosta','Vallejo',
  'Ventura','Victoria','Virginia Beach','Visalia','Waco','Warren','Washington D.C.','Waterbury',
  'Waterloo','Waukegan','West Palm Beach','West Valley City','Westminster','Wheeling','Wichita',
  'Wichita Falls','Wilkes-Barre','Williamsport','Wilmington','Winston-Salem','Worcester',
  'Yakima','Yonkers','York','Youngstown','Yuma'
];

// ---- Team Data (built dynamically at league start) ----
let TEAM_DATA = {};

function randomizeLeagueIdentities() {
  // 1. Generate 32 unique "City Mascot" names
  const generatedNames = generateLeagueNames();

  // 2. Distribute them across divisions (8 per division)
  const divKeys = Object.keys(DIVISIONS);
  divKeys.forEach((div, di) => {
    DIVISIONS[div] = generatedNames.slice(di * 8, di * 8 + 8);
  });

  // 3. Rebuild TEAM_NAMES
  TEAM_NAMES = generatedNames;

  // 4. Build TEAM_DATA — city is already embedded in the name, store it separately too
  TEAM_DATA = {};
  generatedNames.forEach(name => {
    const city = name.split(' ').slice(0, -1).join(' '); // everything before last word
    TEAM_DATA[name] = { city };
  });

  // 5. Assign roles
  const roles = [
    ...Array(6).fill({ p: 'Rebuilding', c: 'R' }),
    ...Array(8).fill({ p: 'Offensive', c: 'O' }),
    ...Array(8).fill({ p: 'Defensive', c: 'D' }),
    ...Array(generatedNames.length - 22).fill({ p: 'Balanced', c: 'B' })
  ];
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  generatedNames.forEach((name, i) => {
    TEAM_DATA[name].philosophy = roles[i].p;
    TEAM_DATA[name].philCode = roles[i].c;
  });

  console.log("League identities randomized!", generatedNames);
}

// ---- Game State ----
const gameState = {
  selectedTeam: null,
  currentSeason: 1,
};
let gameStarted = false;
let leagueGoalies90PlusCount = 0;
let leagueGoalies88PlusCount = 0;

const THEME_COLOR_KEYS = ['--text', '--text2', '--accent', '--ice', '--ice2'];
const THEME_COLOR_DEFAULTS = {
  '--text': '#ecf0f1',
  '--text2': '#8facc8',
  '--accent': '#2980b9',
  '--ice': '#eaf2f8',
  '--ice2': '#d4e6f5',
};

function normalizeHexColor(val){
  if(!val) return '#ffffff';
  const s = String(val).trim();
  if(/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  const m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if(m){
    const h = n => ('0' + Math.min(255, Math.max(0, parseInt(n,10))).toString(16)).slice(-2);
    return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
  }
  return '#ffffff';
}

function applyThemeColors(map, save){
  const root = document.documentElement;
  THEME_COLOR_KEYS.forEach(k => {
    if(map[k]) root.style.setProperty(k, map[k]);
  });
  if(save){
    try {
      const out = {};
      THEME_COLOR_KEYS.forEach(k => { out[k] = getComputedStyle(root).getPropertyValue(k).trim() || map[k]; });
      localStorage.setItem('hockeyGMThemeColors', JSON.stringify(out));
    } catch(e){ console.warn('[Theme] Could not save', e); }
  }
}

function loadThemeFromStorage(){
  try {
    const raw = localStorage.getItem('hockeyGMThemeColors');
    if(!raw) return;
    const data = JSON.parse(raw);
    if(!data || typeof data !== 'object') return;
    applyThemeColors(data, false);
  } catch(e){ console.warn('[Theme] Could not load', e); }
}

// applyOvrTierCSS defined below

function getOvrTierIndex(ovr) {
  for (let i = 0; i < OVR_TIERS.length; i++) {
    if (ovr >= OVR_TIERS[i].min) return i;
  }
  return OVR_TIERS.length - 1;
}

// ovrCell defined below

function getThemeColorMapFromDOM(){
  const root = document.documentElement;
  const map = {};
  THEME_COLOR_KEYS.forEach(k => {
    let v = getComputedStyle(root).getPropertyValue(k).trim();
    if(!v) v = THEME_COLOR_DEFAULTS[k];
    map[k] = normalizeHexColor(v);
  });
  return map;
}

function syncThemeColorPickers(){
  const map = getThemeColorMapFromDOM();
  THEME_COLOR_KEYS.forEach(k => {
    const id = 'theme-color-' + k.replace(/^--/, '');
    const el = document.getElementById(id);
    if(el) el.value = map[k];
  });
}

function bindThemeColorEditor(){
  THEME_COLOR_KEYS.forEach(k => {
    const id = 'theme-color-' + k.replace(/^--/, '');
    const el = document.getElementById(id);
    if(!el) return;
    el.addEventListener('input', () => {
      const root = document.documentElement;
      root.style.setProperty(k, el.value);
      const out = {};
      THEME_COLOR_KEYS.forEach(key => {
        out[key] = getComputedStyle(root).getPropertyValue(key).trim() || THEME_COLOR_DEFAULTS[key];
      });
      try { localStorage.setItem('hockeyGMThemeColors', JSON.stringify(out)); } catch(e){}
    });
  });
}

function resetThemeColors(){
  const root = document.documentElement;
  try { localStorage.removeItem('hockeyGMThemeColors'); } catch(e){}
  THEME_COLOR_KEYS.forEach(k => {
    root.style.removeProperty(k);
    root.style.setProperty(k, THEME_COLOR_DEFAULTS[k]);
  });
  syncThemeColorPickers();
}

function updateGoalieSplit(val){
  val = parseInt(val);
  league.starterSharePct = val;
  try { localStorage.setItem('goalieSplit', val); } catch(e){}
  const starterGames = Math.round(82 * val / 100);
  const backupGames = 82 - starterGames;
  const lbl = document.getElementById('goalie-split-label');
  const sg = document.getElementById('goalie-split-games');
  const bg = document.getElementById('goalie-split-backup-games');
  if(lbl) lbl.textContent = `${val}% / ${100-val}%`;
  if(sg) sg.textContent = starterGames;
  if(bg) bg.textContent = backupGames;
}

function syncGoalieSplitUI(){
  const saved = parseInt(localStorage.getItem('goalieSplit') || '65');
  league.starterSharePct = saved;
  const slider = document.getElementById('goalie-split-slider');
  if(slider) slider.value = saved;
  updateGoalieSplit(saved);
}

function renderOvrTierEditor() {
  const container = document.getElementById('ovr-tier-editor');
  if (!container) return;

  // 1. Build the rows for each tier
  container.innerHTML = OVR_TIERS.map((tier, i) => `
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px; background:rgba(255,255,255,0.03); padding:8px; border-radius:4px;">
      <span style="font-size:12px; font-weight:700; min-width:45px; color:var(--text2);">${tier.min}+</span>
      <input type="text" value="${tier.label}" id="ovr-label-${i}" style="flex:1; background:rgba(0,0,0,0.2); border:1px solid var(--border); color:var(--text); padding:4px; font-size:12px;">
      <input type="color" value="${tier.color}" id="ovr-color-${i}" style="width:44px; height:30px; border:1px solid var(--border); border-radius:4px; cursor:pointer; background:${tier.color}; padding:2px; flex-shrink:0;">
    </div>
  `).join('');

  // 2. Add the Listeners INSIDE a forEach loop so 'i' is defined correctly
  OVR_TIERS.forEach((tier, i) => {
    // Listen for Label changes
    const labelInput = document.getElementById(`ovr-label-${i}`);
    if (labelInput) {
      labelInput.addEventListener('input', (e) => {
        OVR_TIERS[i].label = e.target.value;
        saveOvrTiers(OVR_TIERS);
      });
    }

    // Listen for Color changes
    const colorInput = document.getElementById(`ovr-color-${i}`);
    if (colorInput) {
      colorInput.addEventListener('input', (e) => {
        OVR_TIERS[i].color = e.target.value;
        colorInput.style.background = e.target.value;
        saveOvrTiers(OVR_TIERS);
        applyOvrTierCSS();
      });
    }
  });
}

function resetOvrTiers(){
  OVR_TIERS = OVR_TIER_DEFAULTS.map(t => ({...t}));
  saveOvrTiers(OVR_TIERS);
  applyOvrTierCSS();
  renderOvrTierEditor();
}

// showSettings defined below

// closeModal defined below (single authoritative definition)

// showMenu defined below

// loadGame defined below

function renderTeamGrid(){
  const grid = document.getElementById('teamsel-grid');
  grid.innerHTML = TEAM_NAMES.map(name => {
    const data = TEAM_DATA[name] || { city: name, philosophy:'Balanced', philCode:'B' };
    const initials = name.split(' ').map(w=>w[0]).join('').slice(0,2);
    return `<div class="team-card ${selectedTeamName===name?'selected':''}" onclick="selectTeamCard('${name}')">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
        <div style="width:36px;height:36px;background:var(--red);border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:14px;flex-shrink:0;">${initials}</div>
        <div>
          <div class="team-card-name">${name}</div>
          <div class="team-card-city">${data.city}</div>
        </div>
      </div>
      <span class="team-card-phil phil-${data.philCode}">${data.philosophy}</span>
    </div>`;
  }).join('');
}
function selectTeamCard(name){
  selectedTeamName = name;
  if(!teamPreviewCache[name]) teamPreviewCache[name] = newTeam(name);
  const data = TEAM_DATA[name] || { city:name, philosophy:'Balanced' };
  document.getElementById('teamsel-info').innerHTML = `<strong>${name}</strong> · ${data.city} · <span style="color:var(--gold)">${data.philosophy}</span>`;
  const btn = document.getElementById('teamsel-confirm');
  btn.style.opacity = '1';
  btn.style.pointerEvents = 'auto';
  // Update logo watermark
  const initials = name.split(' ').map(w=>w[0]).join('').slice(0,3);
  const logoBg = document.getElementById('teamsel-logo-bg');
  const logoText = document.getElementById('teamsel-logo-text');
  if(logoText) logoText.textContent = initials;
  if(logoBg) logoBg.style.opacity = '1';
  loadAndApplyLogo(name);
  renderTeamGrid();
  renderTeamPreview(name, teamPreviewCache[name]);
  console.log('[Team Select] Selected:', name, data);
}

function showTeamSelect() {
  // 1. Randomize the team philosophies for this new session
  randomizeLeagueIdentities();
  
  // 2. Clear the cache so it doesn't show players from the previous time you clicked "New Game"
  teamPreviewCache = {}; 

  const menuEl = document.getElementById('screen-menu');
  const teamselEl = document.getElementById('screen-teamsel');
  if(menuEl){ menuEl.classList.remove('active'); menuEl.style.display = 'none'; }
  if(teamselEl){ teamselEl.style.display = ''; teamselEl.classList.add('active'); }
  document.getElementById('app').style.display = 'none';
  
  // 3. Re-render the grid so the new philosophies (colors/text) show up
  renderTeamGrid();
  
  // Reset the preview to null so you have to click a team to see the new roster
  renderTeamPreview(selectedTeamName, selectedTeamName ? teamPreviewCache[selectedTeamName] : null);
}

function teamAverage(roster, positions){
  const filtered = roster.filter(p => positions.includes(p.pos));
  if(!filtered.length) return 0;
  return Math.round(filtered.reduce((sum,p)=>sum+p.ovr,0)/filtered.length);
}

function renderTeamPreview(name, team){
  const statOvr = document.getElementById('teamsel-ovr');
  const statFwd = document.getElementById('teamsel-fwd');
  const statDef = document.getElementById('teamsel-def');
  const statGoal = document.getElementById('teamsel-goal');
  const statRosterSize = document.getElementById('teamsel-roster-size');
  const statAvgAge = document.getElementById('teamsel-avg-age');
  const tbody = document.getElementById('teamsel-roster');
  if(!name){
    if(statOvr) statOvr.textContent = '—';
    if(statFwd) statFwd.textContent = '—';
    if(statDef) statDef.textContent = '—';
    if(statGoal) statGoal.textContent = '—';
    if(statRosterSize) statRosterSize.textContent = '—';
    if(statAvgAge) statAvgAge.textContent = '—';
    if(tbody) tbody.innerHTML = `<tr><td colspan="6" style="color:var(--text2);font-size:13px;text-align:center;padding:18px 0;">Select a team to preview its roster and overall ratings.</td></tr>`;
    return;
  }
  team = team || teamPreviewCache[name] || newTeam(name);
  const ovr = teamOVR(team.roster);
  const fwd = teamAverage(team.roster, ['C','LW','RW']);
  const def = teamAverage(team.roster, ['LD','RD']);
  const goal = teamAverage(team.roster, ['G']);
  const rosterSize = team.roster.length;
  const avgAge = Math.round(team.roster.reduce((sum,p)=>sum+p.age,0)/team.roster.length);
  if(statOvr) statOvr.textContent = ovr || '—';
  if(statFwd) statFwd.textContent = fwd || '—';
  if(statDef) statDef.textContent = def || '—';
  if(statGoal) statGoal.textContent = goal || '—';
  if(statRosterSize) statRosterSize.textContent = rosterSize || '—';
  if(statAvgAge) statAvgAge.textContent = avgAge || '—';
  if(tbody){
    tbody.innerHTML = team.roster.map((p,i)=>`
      <tr>
        <td style="color:var(--text2);font-size:12px;">${i+1}</td>
        <td style="font-weight:500;color:#fff;">${p.name}</td>
        <td><span class="pos-badge" style="font-size:11px;padding:2px 6px;">${p.pos}</span></td>
        <td>${p.age}</td>
        <td>${p.ovr}</td>
        <td>$${p.salary.toFixed(2)}M</td>
      </tr>
    `).join('');
  }
}

function confirmTeamSelect(){
  if(!selectedTeamName) return;
  gameState.selectedTeam = selectedTeamName;
  gameState.currentSeason = 1;
  console.log('[Game Start] Starting as GM of:', gameState.selectedTeam);
  startGame(selectedTeamName, false, teamPreviewCache[selectedTeamName]);
}

function startGame(teamName, isLoad, previewTeam){
  document.getElementById('screen-teamsel').classList.remove('active');
  const menuEl = document.getElementById('screen-menu');
  menuEl.classList.remove('active');
  menuEl.style.display = 'none';
  document.getElementById('app').style.display = 'block';
  gameStarted = true;
  // Set watermark initials
  const initials = (teamName||'IW').split(' ').map(w=>w[0]).join('').slice(0,3);
  const gameLogo = document.getElementById('game-logo-text');
  if(gameLogo) gameLogo.textContent = initials;
  loadAndApplyLogo(teamName);
  if(!isLoad){
    initState(teamName, previewTeam);
    autoSetLines();
    renderAll();
    renderPlayoffs();
  } else {
    autoSetLines();
    renderAll();
    renderPlayoffs();
  }
  console.log('[Game] Season', gameState.currentSeason, '| Team:', teamName);
}

function initState(teamName, previewTeam){
  currentSaveId = null; // new game = no slot yet, first save creates one
  leagueGoalies90PlusCount = 0;
  leagueGoalies88PlusCount = 0;
  state = {
    season: 1, week: 1, playoffsStarted: false, bracket: null,
    myTeam: previewTeam || newTeam(teamName||TEAM_NAMES[0]),
    others: TEAM_NAMES.filter(n => n !== (teamName||TEAM_NAMES[0])).map(n => newTeam(n)),
    fa: Array.from({length: 1200}, () => newFAPlayer()),
    faLog: [], // tracks all FA signings
    log: [],
    morale: 0,
    lines: {
      forwards: [
        { name:'Line 1', slots:['C','LW','RW'], players:[null,null,null] },
        { name:'Line 2', slots:['C','LW','RW'], players:[null,null,null] },
        { name:'Line 3', slots:['C','LW','RW'], players:[null,null,null] },
        { name:'Line 4', slots:['C','LW','RW'], players:[null,null,null] }
      ],
      defense: [
        { name:'Pair 1', slots:['LD','RD'], players:[null,null] },
        { name:'Pair 2', slots:['LD','RD'], players:[null,null] },
        { name:'Pair 3', slots:['LD','RD'], players:[null,null] }
      ],
      goalies: { starter:null, backup:null }
    },
    ahl: { name:(teamName||TEAM_NAMES[0]).split(' ').slice(-1)[0]+' Pack', roster:[], w:0, l:0, otl:0, log:[] },
    echl: { name:(teamName||TEAM_NAMES[0]).split(' ').slice(-1)[0]+' Prospects', roster:[], w:0, l:0, otl:0, log:[] }
  };
  // Initialize calendar — master controller of all league flow
  state.calendar = freshCalendar(2025);
  state.week = 1;
  state.pickInventory = [];
  state.schedule = generateSchedule();
  state.waivers = []; // { player, fromTeam, fromTeamName, placedWeek, claimedBy, exempt }
  initPickInventory();

  // Populate affiliate rosters with prospects (6-7 per affiliate)
  const ahlCount = rnd(6, 7);
  const echlCount = rnd(6, 7);
  for(let i = 0; i < ahlCount; i++){
    const round = rnd(2, 5); // AHL guys are mid-round quality
    const p = newProspect(round, 1.0);
    p.isELC = true;
    p.salary = ELC.maxSalary;
    p.years = rnd(1, 3);
    state.ahl.roster.push(p);
  }
  for(let i = 0; i < echlCount; i++){
    const round = rnd(4, 7); // ECHL guys are later-round / rawer
    const p = newProspect(round, 1.0);
    p.isELC = true;
    p.salary = ELC.maxSalary;
    p.years = rnd(1, 2);
    state.echl.roster.push(p);
  }

  logPlayerTraits(state.myTeam.roster);
}

// ---- render ----
function setEl(id, val, prop='textContent'){
  const el = document.getElementById(id);
  if(el) el[prop] = val;
}

function renderAll(){
  if(!state || !state.myTeam || !gameStarted) return;
  const t = state.myTeam;
  const myPts = t.w*2 + t.otl;
  setEl('hdr-name', t.name);
  setEl('hdr-logo', t.name.split(' ').map(w=>w[0]).join('').slice(0,2));
  setEl('hdr-season', state.season);
  setEl('hdr-record', `${t.w}-${t.l}-${t.otl}`);
  setEl('hdr-pts', myPts);
  const cal = state.calendar || { phase:'Regular Season', week:state.week||1, regularSeasonWeeks:28, year:2025 };
  const phaseLabel = cal.phase || 'Regular Season';
  const weekLabel = cal.week <= cal.regularSeasonWeeks ? `Wk ${cal.week}` : 'Done';
  setEl('hdr-week', weekLabel);
  setEl('hdr-sub', `${cal.year} · ${phaseLabel}`);

  const cap = capLeft();
  const capEl = document.getElementById('sc-cap');
  const capPctUsed = Math.round((capUsed()/league.salaryCap)*100);
  const belowFloor = isBelowFloor(state.myTeam);
  if(capEl){
    capEl.textContent = `$${cap.toFixed(1)}M (${capPctUsed}% used)`;
    capEl.className = 'stat-card-val' + (cap<4?' bad': belowFloor?' warn':cap<10?' warn':' good');
    const capLabel = capEl.previousElementSibling;
    if(capLabel) capLabel.textContent = belowFloor
      ? `CAP SPACE ⚠️ -$${floorDeficit(state.myTeam).toFixed(1)}M FLOOR`
      : 'Cap Space';
  }

  const ovr = teamOVR(t.roster);
  const ovrEl = document.getElementById('sc-ovr');
  if(ovrEl){
    ovrEl.textContent = ovr || '—';
    ovrEl.className = 'stat-card-val' + (ovr>=80?' good':ovr>=70?'':' warn');
  }

  setEl('sc-roster', t.roster.length);
  setEl('sc-morale', state.morale>=3?'🔥':state.morale>0?'😄':state.morale<-3?'😞':state.morale<0?'😐':'😐');

  const all = allTeams().sort((a,b) => pts(b)-pts(a));
  const myRank = all.findIndex(x => x.name === t.name) + 1;
  setEl('sc-standing', myRank ? `#${myRank}` : '—');

  renderRoster();
  renderFA();
  renderStandings();
  renderPower();
  renderLeaders();
  renderPlayoffs();
  renderLog();
  renderContracts();
  renderCalendar();
  renderWaivers();

  // Re-render trade panel if the trade tab is currently active so offers appear live
  const tradeTabContent = document.getElementById("panel-trade");
  if(tradeTabContent && tradeTabContent.classList.contains("active")){
    renderTrade();
  }

  // Keep CPU trade log current whenever trade panel is open
  const tradeLogEl = document.getElementById('cpu-trade-log-entries');
  const tradeLogWrap = document.getElementById('cpu-trade-log');
  if(tradeLogEl && state.tradeLog && state.tradeLog.length){
    if(tradeLogWrap) tradeLogWrap.style.display = 'block';
    tradeLogEl.innerHTML = state.tradeLog.join('<br>');
  }

  // Update trade offer badge on nav
  updateTradeOfferBadge();
}

function updateTradeOfferBadge(){
  const count = (state && state.pendingCPUTrades) ? state.pendingCPUTrades.length : 0;
  let badge = document.getElementById('trade-offer-badge');
  const navBtn = document.getElementById('navg-transactions');
  if(!navBtn) return;
  if(count > 0){
    if(!badge){
      badge = document.createElement('span');
      badge.id = 'trade-offer-badge';
      badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:var(--red2);color:#fff;font-size:10px;font-family:"Barlow Condensed",sans-serif;font-weight:800;letter-spacing:0;margin-left:5px;vertical-align:middle;line-height:1;';
      navBtn.appendChild(badge);
    }
    badge.textContent = count;
  } else {
    if(badge) badge.remove();
  }
}

function pts(t){ return t.w*2+t.otl; }
function allTeams(){ return [state.myTeam, ...state.others]; }

// ── OVR Tier System ─────────────────────────────────────────────
// Each tier has a min OVR, a default color, and a label.
// Colors and labels are editable in Settings.
// OVR_TIER_DEFAULTS, loadOvrTiers, OVR_TIERS declared at top of script

// Returns the text color for a given OVR value
function ovrColor(ovr){
  for(const t of OVR_TIERS){ if(ovr >= t.min) return t.color; }
  return OVR_TIERS[OVR_TIERS.length-1].color;
}

// Returns the label for a given OVR value
function ovrLabel(ovr){
  for(const t of OVR_TIERS){ if(ovr >= t.min) return t.label; }
  return OVR_TIERS[OVR_TIERS.length-1].label;
}

// Injects dynamic CSS for the tier-N classes used by ovrCell/ovrBar
function applyOvrTierCSS(){
  let css = '';
  OVR_TIERS.forEach((t, i) => {
    css += `.tier-${i} { color: ${t.color}; } `;
  });
  let el = document.getElementById('ovr-tier-style');
  if(!el){ el = document.createElement('style'); el.id = 'ovr-tier-style'; document.head.appendChild(el); }
  el.textContent = css;
}

function tierColor(ovr){
  for(let i=0;i<OVR_TIERS.length;i++){ if(ovr>=OVR_TIERS[i].min) return `tier-${i}`; }
  return `tier-${OVR_TIERS.length-1}`;
}
function barColor(ovr){ return ovrColor(ovr); }

function ovrCell(ovr){
  return `<span class="ovr-num ${tierColor(ovr)}">${ovr}</span>`;
}

function applySortRoster(roster){
  const { key, dir } = rosterSort;
  return [...roster].sort((a,b)=>{
    if(key==='pos') return (POSITIONS.indexOf(a.pos)-POSITIONS.indexOf(b.pos))*dir;
    if(key==='name') return a.name.localeCompare(b.name)*dir;
    return (a[key]-b[key])*dir;
  });
}

function sortRoster(key){
  if(rosterSort.key===key) rosterSort.dir*=-1;
  else { rosterSort.key=key; rosterSort.dir = key==='ovr'?-1:1; }
  updateSortIndicators('roster', ['name','pos','age','ovr','salary','years']);
  renderRoster();
}

function faPageNav(dir){
  faPage += dir;
  renderFA();
}

function faFilterChanged(){
  faPage = 0;
  renderFA();
}

function draftPageNav(dir){
  draftPage += dir;
  renderDraft();
}

function sortDraft(key){
  if(draftSort.key===key) draftSort.dir*=-1;
  else { draftSort.key=key; draftSort.dir = key==='ovr'?-1:1; }
  draftPage = 0;
  renderDraft();
}

function sortFA(key){
  if(faSort.key===key) faSort.dir*=-1;
  else { faSort.key=key; faSort.dir = key==='ovr'?-1:1; }
  faPage = 0;
  updateSortIndicators('fa', ['name','pos','age','ovr','salary']);
  renderFA();
}

function updateSortIndicators(table, keys){
  const s = table==='roster' ? rosterSort : faSort;
  keys.forEach(k=>{
    const el = document.getElementById(`sort-${table}-${k}`);
    if(el) el.textContent = s.key===k ? (s.dir===1?'↑':'↓') : '';
  });
}

function renderRoster(){ if(!gameStarted) return;
  const tbody = document.getElementById('roster-tbody');
  const sorted = applySortRoster(state.myTeam.roster);
  tbody.innerHTML = sorted.map((p,i) => `
    <tr>
      <td style="color:var(--text2);font-size:12px;">${i+1}</td>
      <td style="font-weight:500;cursor:pointer;color:#fff;" onclick="openPlayerPage('${p.id}')" title="${p.archetype||''}">${p.name}</td>
      <td><span class="pos-badge">${p.pos}</span></td>
      <td>${p.age}</td>
      <td>${ovrCell(p.ovr)}${p.decliningFast?'<span title="Rapid decline" style="font-size:10px;color:var(--red2);margin-left:3px;">⬇⬇</span>':p.inDecline?'<span title="In decline" style="font-size:10px;color:var(--gold);margin-left:3px;">⬇</span>':''}</td>
      <td>${projBadge(p)}${(()=>{ const rl=readinessLabel(p); return rl?` <span style="font-size:10px;color:${rl.color};">${rl.text}</span>`:''; })()}</td>
      <td>$${p.salary.toFixed(2)}M <span style='font-size:10px;color:var(--text2);'>(${salaryToCapPct(p.salary).toFixed(2)}%)</span></td>
      <td>${p.years}yr${p.isELC?` <span style="font-size:10px;font-family:'Barlow Condensed',sans-serif;font-weight:700;padding:1px 5px;border-radius:3px;background:rgba(243,156,18,0.15);color:var(--gold);border:1px solid rgba(243,156,18,0.3);">ELC</span>`:''}${clauseBadge(p)}
</td>

      <td style="display:flex;gap:6px;"><button class="btn btn-sm" onclick="openExtend('${p.id}')">Extend</button><button class="btn btn-sm" onclick="openRelease('${p.id}')" style="border-color:rgba(192,57,43,0.4);color:var(--red2);">Cut</button></td>
    </tr>`).join('');
}

function renderFA(){ if(!gameStarted) return;
  const countEl = document.getElementById('fa-count');

  // Pending offers display (FA period only)
  const panel2 = document.getElementById('panel-fa');
  let pendingBox = panel2.querySelector('.fa-pending-box');
  if(state.calendar && state.calendar.phase === PHASES.FREE_AGENCY && state.faPendingOffers && state.faPendingOffers.length){
    if(!pendingBox){ pendingBox = document.createElement('div'); pendingBox.className = 'fa-pending-box'; panel2.prepend(pendingBox); }
    pendingBox.style.cssText = 'background:rgba(243,156,18,0.07);border:1px solid rgba(243,156,18,0.35);border-radius:8px;padding:10px 14px;margin-bottom:12px;';
    const rows = state.faPendingOffers.map(o => {
      const competing = (state.cpuPendingOffers || []).filter(c => c.id === o.id);
      const compNote = competing.length ? `<span style="color:#e74c3c;font-size:11px;">⚠️ ${competing.length} other offer${competing.length>1?'s':''}</span>` : '';
      return `<div style="display:flex;align-items:center;gap:12px;padding:4px 0;border-bottom:1px solid rgba(243,156,18,0.1);font-size:13px;">
        <span style="flex:1;color:#fff;font-weight:600;">${o.name}</span>
        <span class="pos-badge" style="font-size:10px;">${o.pos}</span>
        <span style="color:var(--text2);">${o.ovr} OVR</span>
        <span style="color:var(--gold);">$${o.sal.toFixed(2)}M / ${o.yrs}yr</span>
        ${compNote}
        <span style="color:var(--text2);font-size:11px;">⏳ deciding…</span>
      </div>`;
    }).join('');
    pendingBox.innerHTML = `<div style="font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:1px;font-size:11px;margin-bottom:8px;">⏳ Pending Offers — resolves when you sim a day</div>${rows}`;
  } else if(pendingBox){ pendingBox.remove(); }

  // Render signing log
  const logWrap = document.getElementById('fa-signing-log');
  const logEntries = document.getElementById('fa-signing-log-entries');
  if(logWrap && logEntries && state.faLog && state.faLog.length){
    logWrap.style.display = 'block';
    logEntries.innerHTML = state.faLog.join('<br>');
  }
  const tbody = document.getElementById('fa-tbody');
  const searchVal = (document.getElementById('fa-search')?.value || '').toLowerCase().trim();
  const posVal    = (document.getElementById('fa-pos-filter')?.value || '').toUpperCase().trim();
  const ovrVal    = (document.getElementById('fa-ovr-filter')?.value || '').trim();
  const ageVal    = (document.getElementById('fa-age-filter')?.value || '').trim();
  const potVal    = (document.getElementById('fa-pot-filter')?.value || '').toUpperCase().trim();

  // Parse "76-80" or "76+" or just "76" into [min, max]
  function parseRange(str, fallbackMax=99){
    if(!str) return [0, fallbackMax];
    const plusMatch = str.match(/^(\d+)\+$/);
    if(plusMatch) return [parseInt(plusMatch[1]), fallbackMax];
    const rangeMatch = str.match(/^(\d+)[-–](\d+)$/);
    if(rangeMatch) return [parseInt(rangeMatch[1]), parseInt(rangeMatch[2])];
    const single = parseInt(str);
    if(!isNaN(single)) return [single, single];
    return [0, fallbackMax];
  }

  const [ovrMin, ovrMax] = parseRange(ovrVal);
  const [ageMin, ageMax] = parseRange(ageVal);

  const sortedFA = [...state.fa]
    .filter(p => {
      if(searchVal && !p.name.toLowerCase().includes(searchVal)) return false;
      if(posVal && p.pos !== posVal) return false;
      if(ovrVal && (p.ovr < ovrMin || p.ovr > ovrMax)) return false;
      if(ageVal && (p.age < ageMin || p.age > ageMax)) return false;
      if(potVal && p.potential !== potVal) return false;
      return true;
    })
    .sort((a,b)=>{
      const { key, dir } = faSort;
      if(key==='name') return a.name.localeCompare(b.name)*dir;
      if(key==='pos') return (POSITIONS.indexOf(a.pos)-POSITIONS.indexOf(b.pos))*dir;
      return (a[key]-b[key])*dir;
    });

  // Clamp faPage if filters reduce the list
  const totalPages = Math.max(1, Math.ceil(sortedFA.length / FA_PAGE_SIZE));
  if(faPage >= totalPages) faPage = totalPages - 1;
  if(faPage < 0) faPage = 0;

  const pageStart = faPage * FA_PAGE_SIZE;
  const pageEnd   = Math.min(pageStart + FA_PAGE_SIZE, sortedFA.length);
  const pageFA    = sortedFA.slice(pageStart, pageEnd);

  if(countEl) countEl.textContent = sortedFA.length === state.fa.length
    ? state.fa.length
    : `${sortedFA.length} / ${state.fa.length}`;

  tbody.innerHTML = pageFA.map(p => `
    <tr>
      <td style="font-weight:500;cursor:pointer;color:#fff;" onclick="openPlayerPage('${p.id}')" title="Click to view player card">${p.name}${p._myTeam?'<span style="font-size:10px;color:var(--gold);margin-left:6px;">YOUR FA</span>':''}</td>
      <td><span class="pos-badge">${p.pos}</span></td>
      <td>${p.age}</td>
      <td>${ovrCell(p.ovr)}</td>
      <td>${projBadge(p)}</td>
      <td>$${(p.salary ?? 0).toFixed(1)}M/yr</td>
      <td><button class="btn btn-sm btn-gold" onclick="openSign('${p.id}')">Offer</button></td>
    </tr>`).join('');

  // Pagination controls
  let paginator = document.getElementById('fa-paginator');
  if(!paginator){
    paginator = document.createElement('div');
    paginator.id = 'fa-paginator';
    paginator.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:14px;padding:12px 0;font-size:13px;';
    tbody.closest('table').insertAdjacentElement('afterend', paginator);
  }
  paginator.innerHTML = `
    <button class="btn btn-sm" onclick="faPageNav(-1)" ${faPage === 0 ? 'disabled' : ''}>◀ Prev</button>
    <span style="color:var(--text2);">Page <strong style="color:#fff;">${faPage + 1}</strong> of <strong style="color:#fff;">${totalPages}</strong> &nbsp;·&nbsp; ${sortedFA.length} players</span>
    <button class="btn btn-sm" onclick="faPageNav(1)" ${faPage >= totalPages - 1 ? 'disabled' : ''}>Next ▶</button>
  `;
  // Add new season button if in offseason FA phase
  const panel = document.getElementById('panel-fa');
  let banner = panel.querySelector('.fa-offseason-banner');
  if(state.offseasonPhase==='fa'){
    if(!banner){
      banner = document.createElement('div');
      banner.className='fa-offseason-banner offseason-banner';
      banner.style.marginBottom='16px';
      banner.innerHTML=`<h2>Free Agency</h2><p>Make offers to players — they'll decide the next day. Sim a day to resolve pending offers and let CPU teams sign too.</p><div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap;"><button class="btn btn-gold" onclick="simFADay()">⏭ Sim FA Day</button><button class="btn btn-red" onclick="startNewSeason()">▶ Start Season ${(state.season||1)+1}</button></div>`;
      panel.insertBefore(banner, panel.firstChild);
    }
  } else if(banner){ banner.remove(); }
}

function getTeamByName(name){ return allTeams().find(t=>t.name===name); }

/** Resolve a player for the player card: your roster, FA, waivers limbo, or another NHL team. */
function findPlayerById(id){
  const mine = state.myTeam.roster.find(x => x.id === id);
  if(mine) return { player: mine, source: 'my' };
  const fa = state.fa.find(x => x.id === id);
  if(fa) return { player: fa, source: 'fa' };
  // Check waiver limbo
  if(state.waivers){
    const wEntry = state.waivers.find(w => w.player.id === id && !w.claimedBy && !w.cleared);
    if(wEntry) return { player: wEntry.player, source: 'waivers' };
  }
  for(const t of state.others || []){
    const op = t.roster.find(x => x.id === id);
    if(op) return { player: op, source: 'other', teamName: t.name };
  }
  return null;
}

function openTeamRosterFromPower(teamName){
  const team = getTeamByName(teamName);
  if(!team || !team.roster){ return; }
  const titleEl = document.getElementById('modal-team-roster-title');
  const subEl = document.getElementById('modal-team-roster-sub');
  const bodyEl = document.getElementById('modal-team-roster-body');
  if(titleEl) titleEl.textContent = team.name;
  const ovr = teamOVR(team.roster);
  const rec = `${team.w||0}-${team.l||0}-${team.otl||0}`;
  if(subEl) subEl.innerHTML = `Record <strong>${rec}</strong> · Team OVR <strong>${ovr}</strong> · Click a player for a full scouting card.`;

  const sorted = [...team.roster].sort((a, b) => (b.ovr || 0) - (a.ovr || 0));
  const rows = sorted.map((p, i) => {
    const s = getStatLine(p);
    const pts = p.pos === 'G'
      ? `<span style="color:var(--text2);">${s.w||0}W ${(s.sa>0 ? ((s.saves/s.sa)*100).toFixed(1) : '0.0')}%</span>`
      : `<span style="color:var(--text2);">${s.g||0}G-${s.a||0}A</span>`;
    return `<tr>
      <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);color:var(--text2);font-size:12px;">${i+1}</td>
      <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);font-weight:600;cursor:pointer;color:#fff;" onclick="closeModal('modal-team-roster');openPlayerPage('${p.id}')">${p.name}</td>
      <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);"><span class="pos-badge">${p.pos}</span></td>
      <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">${p.age}</td>
      <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">${ovrCell(p.ovr)}</td>
      <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);font-size:12px;">$${p.salary.toFixed(2)}M</td>
      <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);font-size:12px;">${pts}</td>
    </tr>`;
  }).join('');

  if(bodyEl){
    bodyEl.innerHTML = `<div class="table-wrap"><table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr>
        <th style="text-align:left;padding:6px 8px;font-size:11px;color:var(--text2);border-bottom:1px solid var(--border);">#</th>
        <th style="text-align:left;padding:6px 8px;font-size:11px;color:var(--text2);border-bottom:1px solid var(--border);">Player</th>
        <th style="text-align:left;padding:6px 8px;font-size:11px;color:var(--text2);border-bottom:1px solid var(--border);">Pos</th>
        <th style="text-align:left;padding:6px 8px;font-size:11px;color:var(--text2);border-bottom:1px solid var(--border);">Age</th>
        <th style="text-align:left;padding:6px 8px;font-size:11px;color:var(--text2);border-bottom:1px solid var(--border);">OVR</th>
        <th style="text-align:left;padding:6px 8px;font-size:11px;color:var(--text2);border-bottom:1px solid var(--border);">Salary</th>
        <th style="text-align:left;padding:6px 8px;font-size:11px;color:var(--text2);border-bottom:1px solid var(--border);">Season</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  document.getElementById('modal-team-roster').classList.add('open');
}

function getPlayoffTeams(){
  // Top 3 from each division + 2 wildcards per conference (16 total)
  const playoffTeams = new Set();
  const wildcards = {};
  Object.entries(CONFERENCES).forEach(([conf, divs])=>{
    const confTeams = [];
    divs.forEach(div=>{
      const divTeams = DIVISIONS[div].map(n=>getTeamByName(n)).filter(Boolean).sort((a,b)=>pts(b)-pts(a));
      divTeams.slice(0,3).forEach(t=>{ playoffTeams.add(t.name); });
      confTeams.push(...divTeams.slice(3));
    });
    confTeams.sort((a,b)=>pts(b)-pts(a));
    confTeams.slice(0,2).forEach(t=>{ playoffTeams.add(t.name); wildcards[t.name]=true; });
  });
  return { playoffTeams, wildcards };
}

function renderStandings(){ if(!gameStarted) return;
  const el = document.getElementById('standings-body');
  const { playoffTeams, wildcards } = getPlayoffTeams();
  let html = '';
  Object.entries(CONFERENCES).forEach(([conf, divs])=>{
    html += `<div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1px;padding:14px 0 6px;">${conf} Conference</div>`;
    divs.forEach(div=>{
      const divTeams = DIVISIONS[div].map(n=>getTeamByName(n)).filter(Boolean).sort((a,b)=>pts(b)-pts(a));
      html += `<div style="font-size:11px;color:var(--accent);text-transform:uppercase;letter-spacing:1px;padding:6px 12px 4px;font-weight:700;">${div} Division</div>`;
      divTeams.forEach((t,i)=>{
        const mine = t.name === state.myTeam.name;
        const inPlayoffs = playoffTeams.has(t.name);
        const isWild = wildcards[t.name];
        const indicator = i<3 ? `<span style="font-size:10px;color:#2ecc71;margin-left:4px;">D</span>` : isWild ? `<span style="font-size:10px;color:var(--gold);margin-left:4px;">WC</span>` : '';
        html += `<div class="standings-row ${mine?'mine':''}" style="${!inPlayoffs?'opacity:0.6':''}">
          <div class="spos">${i+1}</div>
          <div class="sname">${t.name}${mine?' ⭐':''}${indicator}</div>
          <div class="srec">${t.w}-${t.l}-${t.otl}</div>
          <div class="spts">${pts(t)}</div>
        </div>`;
      });
    });
  });
  el.innerHTML = html;
}

function renderPower(){ if(!gameStarted) return;
  const sorted = allTeams().map(t => ({...t, ovr: teamOVR(t.roster)})).sort((a,b) => b.ovr - a.ovr);
  const el = document.getElementById('power-body');
  const best = sorted[0].ovr;
  const worst = sorted[sorted.length-1].ovr;
  const span = Math.max(0.001, best - worst);
  el.innerHTML = sorted.map((t,i) => {
    const mine = t.name === state.myTeam.name;
    const pct = ((t.ovr - worst) / span * 100).toFixed(0);
    const teamJs = JSON.stringify(t.name);
    return `<div class="standings-row ${mine?'mine':''}" role="button" tabindex="0" title="View roster"
      onclick='openTeamRosterFromPower(${teamJs})'
      onkeydown='if(event.key==="Enter"||event.key===" "){event.preventDefault();openTeamRosterFromPower(${teamJs});}'
      style="gap:12px;cursor:pointer;">
      <div class="spos">${i+1}</div>
      <div class="sname">${t.name}${mine?' ⭐':''}</div>
      <div style="flex:1;display:flex;align-items:center;gap:8px;">
        <div style="flex:1;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;">
          <div style="width:${pct}%;height:100%;border-radius:2px;background:${ovrColor(t.ovr)};"></div>
        </div>
      </div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:18px;color:${ovrColor(t.ovr)}">${t.ovr}</div>
    </div>`;
  }).join('');
}

function renderLeaders(){
  if(!gameStarted) return;
  const el = document.getElementById('leaders-body');
  if(!el) return;

  const skaters = [];
  const goalies = [];
  allTeams().forEach(team => {
    team.roster.forEach(p => {
      const row = { p, team: team.name, s: getStatLine(p) };
      if(p.pos === 'G') goalies.push(row);
      else skaters.push(row);
    });
  });

  const mineTeam = state.myTeam.name;
  const teamAbr = (name) => name.split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase();
  const rowBg = (team) => team === mineTeam ? 'background:rgba(41,128,185,0.12);' : '';
  const th = 'text-align:left;padding:6px 8px;font-size:11px;color:var(--text2);border-bottom:1px solid var(--border);text-transform:uppercase;letter-spacing:0.7px;';
  const td = (team) => `padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.08);font-size:13px;${rowBg(team)}`;

  const skTable = (title, rows, statCells) => {
    const head = `<tr><th style="${th}">#</th><th style="${th}">Player</th><th style="${th}">Tm</th><th style="${th}">GP</th>${statCells.headers}</tr>`;
    const body = rows.map((r, i) => {
      const star = r.team === mineTeam ? ' ★' : '';
      return `<tr>
        <td style="${td(r.team)}">${i + 1}</td>
        <td style="${td(r.team)};font-weight:600;">${r.p.name}${star}</td>
        <td style="${td(r.team)};color:var(--text2);">${teamAbr(r.team)}</td>
        <td style="${td(r.team)}">${r.s.gp || 0}</td>
        ${statCells.cells(r)}</tr>`;
    }).join('');
    return `<div style="margin-bottom:20px;">
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">${title}</div>
      <div class="table-wrap"><table style="width:100%;border-collapse:collapse;"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    </div>`;
  };

  const byGoals = [...skaters].sort((a, b) =>
    (b.s.g || 0) - (a.s.g || 0) || (b.s.a || 0) - (a.s.a || 0) || (a.s.gp || 0) - (b.s.gp || 0)
  ).slice(0, 15);
  const byAst = [...skaters].sort((a, b) =>
    (b.s.a || 0) - (a.s.a || 0) || (b.s.g || 0) - (a.s.g || 0) || (a.s.gp || 0) - (b.s.gp || 0)
  ).slice(0, 15);
  const byPts = [...skaters].sort((a, b) => {
    const pa = (a.s.g || 0) + (a.s.a || 0), pb = (b.s.g || 0) + (b.s.a || 0);
    return pb - pa || (b.s.g || 0) - (a.s.g || 0) || (a.s.gp || 0) - (b.s.gp || 0);
  }).slice(0, 15);
  const byPM = [...skaters].sort((a, b) =>
    (b.s.pm || 0) - (a.s.pm || 0) || (b.s.g || 0) - (a.s.g || 0) || (a.s.gp || 0) - (b.s.gp || 0)
  ).slice(0, 15);

  const gQualified = goalies.filter(g => (g.s.gp || 0) > 0 && (g.s.sa || 0) > 0);
  const byGw = [...goalies].sort((a, b) =>
    (b.s.w || 0) - (a.s.w || 0) || (a.s.ga || 0) - (b.s.ga || 0)
  ).slice(0, 10);
  const bySv = [...gQualified].sort((a, b) =>
    calcSV(b.p) - calcSV(a.p) || (b.s.sa || 0) - (a.s.sa || 0)
  ).slice(0, 10);
  const byGaa = [...gQualified].sort((a, b) =>
    parseFloat(calcGAA(a.p)) - parseFloat(calcGAA(b.p)) || (b.s.sa || 0) - (a.s.sa || 0)
  ).slice(0, 10);

  const gTable = (title, rows, extraHead, rowHtml) => {
    const head = `<tr><th style="${th}">#</th><th style="${th}">Goalie</th><th style="${th}">Tm</th><th style="${th}">GP</th>${extraHead}</tr>`;
    const body = rows.map((r, i) => rowHtml(r, i)).join('');
    return `<div style="margin-bottom:20px;">
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">${title}</div>
      <div class="table-wrap"><table style="width:100%;border-collapse:collapse;"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    </div>`;
  };

  let html = `<div style="font-size:12px;color:var(--text2);margin-bottom:14px;">Regular season player stats league-wide (updates when you sim weeks).</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px 20px;">`;

  html += skTable('Goals', byGoals, {
    headers: `<th style="${th}">G</th>`,
    cells: (r) => `<td style="${td(r.team)};font-family:'Barlow Condensed',sans-serif;font-weight:700;">${r.s.g || 0}</td>`
  });
  html += skTable('Assists', byAst, {
    headers: `<th style="${th}">A</th>`,
    cells: (r) => `<td style="${td(r.team)};font-family:'Barlow Condensed',sans-serif;font-weight:700;">${r.s.a || 0}</td>`
  });
  html += skTable('Points', byPts, {
    headers: `<th style="${th}">PTS</th>`,
    cells: (r) => `<td style="${td(r.team)};font-family:'Barlow Condensed',sans-serif;font-weight:700;">${(r.s.g || 0) + (r.s.a || 0)}</td>`
  });
  html += skTable('Plus / Minus', byPM, {
    headers: `<th style="${th}">+/-</th>`,
    cells: (r) => `<td style="${td(r.team)};font-family:'Barlow Condensed',sans-serif;font-weight:700;color:${(r.s.pm || 0) > 0 ? '#2ecc71' : (r.s.pm || 0) < 0 ? 'var(--red2)' : 'var(--text)'};">${r.s.pm > 0 ? '+' : ''}${r.s.pm || 0}</td>`
  });

  html += `</div>`;

  html += gTable('Goalie — Wins', byGw,
    `<th style="${th}">W</th><th style="${th}">L</th><th style="${th}">GA</th>`,
    (r, i) => {
      const star = r.team === mineTeam ? ' ★' : '';
      return `<tr>
        <td style="${td(r.team)}">${i + 1}</td>
        <td style="${td(r.team)};font-weight:600;">${r.p.name}${star}</td>
        <td style="${td(r.team)};color:var(--text2);">${teamAbr(r.team)}</td>
        <td style="${td(r.team)}">${r.s.gp || 0}</td>
        <td style="${td(r.team)};font-weight:700;">${r.s.w || 0}</td>
        <td style="${td(r.team)}">${r.s.l || 0}</td>
        <td style="${td(r.team)}">${r.s.ga || 0}</td></tr>`;
    }
  );

  html += gTable('Goalie — Save % (min. 1 GP)', bySv,
    `<th style="${th}">SV%</th><th style="${th}">SA</th>`,
    (r, i) => {
      const star = r.team === mineTeam ? ' ★' : '';
      const pct = r.s.sa > 0 ? ((r.s.saves / r.s.sa) * 100).toFixed(2) : '—';
      return `<tr>
        <td style="${td(r.team)}">${i + 1}</td>
        <td style="${td(r.team)};font-weight:600;">${r.p.name}${star}</td>
        <td style="${td(r.team)};color:var(--text2);">${teamAbr(r.team)}</td>
        <td style="${td(r.team)}">${r.s.gp || 0}</td>
        <td style="${td(r.team)};font-weight:700;">${pct}</td>
        <td style="${td(r.team)}">${r.s.sa || 0}</td></tr>`;
    }
  );

  html += gTable('Goalie — GAA (min. 1 GP)', byGaa,
    `<th style="${th}">GAA</th><th style="${th}">SV%</th>`,
    (r, i) => {
      const star = r.team === mineTeam ? ' ★' : '';
      const sv = r.s.sa > 0 ? ((r.s.saves / r.s.sa) * 100).toFixed(2) : '—';
      return `<tr>
        <td style="${td(r.team)}">${i + 1}</td>
        <td style="${td(r.team)};font-weight:600;">${r.p.name}${star}</td>
        <td style="${td(r.team)};color:var(--text2);">${teamAbr(r.team)}</td>
        <td style="${td(r.team)}">${r.s.gp || 0}</td>
        <td style="${td(r.team)};font-weight:700;">${calcGAA(r.p)}</td>
        <td style="${td(r.team)}">${sv}</td></tr>`;
    }
  );

  el.innerHTML = html;
}

function renderLog(){
  if(!state || !state.myTeam || !gameStarted) return;
  const el = document.getElementById('game-log');
  if(!state.log.length){ el.innerHTML = '<div style="color:var(--text2);font-size:13px;">No games simulated yet.</div>'; return; }
  el.innerHTML = [...state.log].reverse().map(e => `<div class="log-line">${e}</div>`).join('');
}

// Trade state: arrays of selected player IDs and pick rounds
let trade = { myPlayers:[], myPicks:[], theirPlayers:[], theirPicks:[], team:null, myRetain:{} };
let tradeBlock = new Set(); // player IDs my team has put on the trade block
let pickBlock  = new Set(); // pick IDs my team has put on the trade block
// What I want in return for each blocked player/pick — keyed by id
// Values: 'any' | 'picks_only' | 'r1_only' | 'players_only' | 'player_and_pick'
let tradeBlockDemands = {};
let tradeFilter = { my:{ q:'', pos:'', minOvr:'' }, their:{ q:'', pos:'', minOvr:'' } };

// ----------------------------------------------------------------
// PICK INVENTORY SYSTEM
// Each pick: { id, originalTeam, ownerTeam, round, season }
// ----------------------------------------------------------------
function generateTeamPicks(teamName, currentSeason){
  const picks = [];
  // Each team owns their own picks for current season + next 9 years
  for(let yr = 0; yr <= 9; yr++){
    for(let r = 1; r <= 7; r++){
      picks.push({
        id: `${teamName}-${currentSeason+yr}-R${r}`,
        originalTeam: teamName,
        ownerTeam: teamName,
        round: r,
        season: currentSeason + yr,
      });
    }
  }
  return picks;
}

function initPickInventory(){
  if(!state.pickInventory) state.pickInventory = [];
  // Add picks for any team that doesn't have them yet
  const season = state.season || 1;
  allTeams().forEach(team => {
    // Check if this team already has picks generated
    const hasCurrentPicks = state.pickInventory.some(p => p.ownerTeam===team.name || p.originalTeam===team.name);
    if(!hasCurrentPicks){
      generateTeamPicks(team.name, season).forEach(p => state.pickInventory.push(p));
    }
  });
}

function getTeamPicks(teamName){
  if(!state.pickInventory) return [];
  return state.pickInventory.filter(p => p.ownerTeam === teamName)
    .sort((a,b) => a.season!==b.season ? a.season-b.season : a.round-b.round);
}

function pickLabel(pk){
  const own = !pk.originalTeam || pk.originalTeam === pk.ownerTeam;
  const short = pk.originalTeam ? pk.originalTeam.split(' ').map(w=>w[0]).join('').slice(0,3).toUpperCase() : '???';
  // Convert season number to real draft year.
  // Draft happens in June — the second calendar year of the season (cal.year + 1).
  // e.g. Season 1 starting in 2025 → Draft in June 2026.
  const baseCalYear = state?.calendar?.year || 2025;
  const currentSeason = state?.season || 1;
  const draftYear = baseCalYear + (pk.season - currentSeason) + 1;
  return `${draftYear} R${pk.round}${own?'':' ('+short+')'}`;
}

function pickValueScore(pk){
  /*
   * Pick values scaled to match the new player value range (~50–4000+).
   * Picks are useful for sweetening mid-tier deals but cannot approach
   * the value of a franchise 90+ OVR player.
   *
   * Round base values (current season):
   *   R1=500  R2=240  R3=120  R4=70  R5=42  R6=26  R7=15
   *
   * Future discount: picks further out are riskier (unknown draft position).
   * Each additional season knocks off 12% of value (compound).
   */
  const ROUND_BASE = [0, 900, 450, 220, 130, 80, 50, 30]; // index = round (1-7)
  const base = ROUND_BASE[pk.round] || 15;
  const yearsOut = Math.max(0, (pk.season || 0) - (state.season || 1));
  const futureDiscount = Math.pow(0.93, yearsOut); // 7% per year out (was 12%)
  return Math.max(1, Math.round(base * futureDiscount));
}

function advancePickInventory(){
  // Called at start of new season — remove picks from past season, add new future year
  if(!state.pickInventory) return;
  const newSeason = state.season;
  // Remove picks that were for the season that just ended
  state.pickInventory = state.pickInventory.filter(p => p.season >= newSeason);
  // Add picks for 9 years out if not already there
  const futureYear = newSeason + 9;
  allTeams().forEach(team => {
    for(let r=1; r<=7; r++){
      const id = `${team.name}-${futureYear}-R${r}`;
      if(!state.pickInventory.find(p=>p.id===id)){
        state.pickInventory.push({ id, originalTeam:team.name, ownerTeam:team.name, round:r, season:futureYear });
      }
    }
  });
}

function tradeTeamName(){ return trade.team || (state.others[0]&&state.others[0].name) || ''; }

/** Find a player anywhere in my org (NHL + AHL + ECHL), returns player with _league tag */
function findInMyOrg(id){
  let p = state.myTeam.roster.find(x=>x.id===id);
  if(p) return {...p, _league:'NHL'};
  if(state.ahl&&state.ahl.roster){ p=state.ahl.roster.find(x=>x.id===id); if(p) return {...p, _league:'AHL'}; }
  if(state.echl&&state.echl.roster){ p=state.echl.roster.find(x=>x.id===id); if(p) return {...p, _league:'ECHL'}; }
  return null;
}

/** Remove a player from whichever org roster they're on */
function removeFromMyOrg(id){
  if(state.myTeam.roster.find(x=>x.id===id)){ state.myTeam.roster=state.myTeam.roster.filter(x=>x.id!==id); return; }
  if(state.ahl&&state.ahl.roster&&state.ahl.roster.find(x=>x.id===id)){ state.ahl.roster=state.ahl.roster.filter(x=>x.id!==id); return; }
  if(state.echl&&state.echl.roster&&state.echl.roster.find(x=>x.id===id)){ state.echl.roster=state.echl.roster.filter(x=>x.id!==id); }
}

function tradePlayerOVRValue(players){
  /*
   * VALUE SYSTEM — anchored to cap percentage (0-100 scale where 100 = full cap)
   *
   * Base value = cap hit % of the salary cap. An elite 90 OVR player on ~10.5% cap
   * is worth ~10.5 points before adjustments. Multipliers then scale for:
   *   - OVR tier (stars are worth more than their cap hit alone)
   *   - Years remaining (a player with 5 yrs left is more valuable than 1 yr)
   *   - Age (prime players get a premium; declining players a discount)
   *   - Prospect ceiling (AHL/ECHL guys valued on potential, not current OVR)
   *
   * All values end up in a 0–200 range per player.
   * Picks are calibrated to the same scale (see pickValueScore).
   */
  return Math.round(players.reduce((s, id) => {
    const p = state.myTeam.roster.find(x => x.id === id)
              || (state.ahl&&state.ahl.roster&&state.ahl.roster.find(x=>x.id===id))
              || (state.echl&&state.echl.roster&&state.echl.roster.find(x=>x.id===id))
              || state.others.flatMap(t => [
                   ...t.roster,
                   ...(t.cpuAHL&&t.cpuAHL.roster ? t.cpuAHL.roster : []),
                   ...(t.cpuECHL&&t.cpuECHL.roster ? t.cpuECHL.roster : []),
                 ]).find(x => x.id === id);
    if (!p) return s;

    const ovr = p.ovr || 60;
    const age = p.age || 25;
    const yrs = p.years || 0;
    const cap = league.salaryCap || 104;

    // ── PROSPECT PATH (AHL/ECHL or ELC rookies) ─────────────────────────────
    // These players are valued on ceiling, not current OVR.
    const isProspect = p.isDraftee || (ovr < 73 && age <= 23);
    if (isProspect) {
      // Base: perceived ceiling OVR mapped to a cap-equivalent value
      const ceil = p.potCeil || p.trueCeilOVR || (ovr + 8); // fallback guess
      // What they'd earn at ceiling — same scale as NHL path (cap% * ovrMult * 100)
      const ceilCapPct = playerCapPctFromOVR(ceil);
      const ceilOvrMult = ceil >= 90 ? 10.0
                        : ceil >= 87 ? 5.0
                        : ceil >= 85 ? 3.0
                        : ceil >= 82 ? 1.4
                        : ceil >= 80 ? 1.0
                        : ceil >= 75 ? 0.7
                        : 0.5;
      const ceilVal = ceilCapPct * ceilOvrMult * 100; // same scale as NHL path

      // Discount for years until ready + uncertainty
      const yearsToReady = Math.max(1, (p.devVariance&&p.devVariance.readinessAge ? p.devVariance.readinessAge - age : 3));
      const discountPerYear = 0.82; // ~18% uncertainty per year out
      const discount = Math.pow(discountPerYear, yearsToReady);

      // Potential grade bonus (A/B/C or letter grade)
      const gradeMult = p.potential==='A' ? 2.0 : p.potential==='B' ? 1.0 : 0.5;

      // Age bonus — younger prospects retain more upside
      const ageBonus = age <= 19 ? 1.2 : age <= 21 ? 1.1 : age <= 23 ? 1.0 : 0.9;

      return s + Math.max(15, ceilVal * discount * gradeMult * ageBonus);
    }

    // ── NHL PLAYER PATH ──────────────────────────────────────────────────────
    // 1. Base cap value: actual salary as % of cap (0–15 range)
    const salaryCapPct = p.salary ? (p.salary / cap * 100) : playerCapPctFromOVR(ovr);

    // 2. OVR tier multiplier — exponential curve makes 90+ nearly untradeable
    //    <75 → 0.5×   75 → 0.7×   80 → 1.0×   82 → 1.4×   85 → 3.0×   87 → 5.0×   90 → 10×   92 → 16×   95 → 26×
    const ovrMult = ovr >= 95 ? 26.0
                  : ovr >= 93 ? 20.0
                  : ovr >= 92 ? 16.0
                  : ovr >= 90 ? 10.0
                  : ovr >= 87 ? 5.0
                  : ovr >= 85 ? 3.0
                  : ovr >= 82 ? 1.4
                  : ovr >= 80 ? 1.0
                  : ovr >= 75 ? 0.7
                  : 0.5;

    // 3. Contract term multiplier — more years remaining = more value
    //    0 yrs (expiring) → 0.5×    1 yr → 0.75×    3 yrs → 1.0×    6+ yrs → 1.3×
    const yrsMult = yrs >= 6 ? 1.3
                  : yrs >= 4 ? 1.15
                  : yrs >= 3 ? 1.0
                  : yrs >= 2 ? 0.85
                  : yrs >= 1 ? 0.75
                  : 0.5;

    // 4. Age multiplier — prime age premium, discount for aging veterans
    //    ≤23 → 1.15×   24-27 → 1.1×   28-30 → 1.0×   31-32 → 0.85×   33+ → 0.7×
    const ageMult = age <= 23 ? 1.15
                  : age <= 27 ? 1.1
                  : age <= 30 ? 1.0
                  : age <= 32 ? 0.85
                  : 0.7;

    // 5. Value on a cap-equivalent scale (multiply by 100 to lift range to ~50–4000+)
    const val = salaryCapPct * ovrMult * yrsMult * ageMult * 100;

    return s + Math.max(1, val);
  }, 0));
}

/** Helper: approximate cap % a player at a given OVR would earn */
function playerCapPctFromOVR(ovr){
  if(ovr >= 95) return 14.0;
  if(ovr >= 92) return 12.5;
  if(ovr >= 90) return 10.8;
  if(ovr >= 87) return 7.5;
  if(ovr >= 85) return 5.2;
  if(ovr >= 82) return 2.8;
  if(ovr >= 80) return 1.5;
  if(ovr >= 75) return 0.9;
  if(ovr >= 70) return 0.8;
  return 0.775; // league min
}

function tradePickValue(picks){
  return Math.round(picks.reduce((s, pk) => s + pickValueScore(pk), 0));
}

function setRetain(id, pct){ trade.myRetain[id] = pct; renderTrade(); }

function myTradeValue(){
  const playerVal = tradePlayerOVRValue(trade.myPlayers);
  const pickVal   = tradePickValue(trade.myPicks);
  // Retention bonus: scaled by OVR (starting at 80), salary retained, and years remaining.
  // The higher the player's OVR and the longer the deal, the more valuable eating salary becomes.
  let retentionBonus = 0;
  trade.myPlayers.forEach(id => {
    const pct = trade.myRetain[id] || 0;
    if(pct <= 0) return;
    const p = findInMyOrg(id);
    if(!p) return;

    const ovr = p.ovr || 60;
    const yrs = p.years || 1;
    const retainedSalary = p.salary * (pct / 100); // actual $ being eaten

    // OVR scale: starts meaningful at 80, grows steeply above 87
    // <80 → 0.5×   80 → 1.0×   82 → 1.4×   85 → 2.0×   87 → 2.8×   90 → 4.0×   92 → 5.5×   95 → 8.0×
    const ovrScale = ovr >= 95 ? 8.0
                   : ovr >= 92 ? 5.5
                   : ovr >= 90 ? 4.0
                   : ovr >= 87 ? 2.8
                   : ovr >= 85 ? 2.0
                   : ovr >= 82 ? 1.4
                   : ovr >= 80 ? 1.0
                   : 0.5;

    // Years scale: longer deal = more total money eaten = more valuable relief
    // 1yr → 0.7×   2yr → 0.9×   3yr → 1.1×   4yr → 1.25×   5yr → 1.4×   6+yr → 1.6×
    const yrsScale = yrs >= 6 ? 1.6
                   : yrs >= 5 ? 1.4
                   : yrs >= 4 ? 1.25
                   : yrs >= 3 ? 1.1
                   : yrs >= 2 ? 0.9
                   : 0.7;

    // Base: $1M retained = 150 pts, then scaled by OVR and years
    retentionBonus += Math.round(retainedSalary * 150 * ovrScale * yrsScale);
  });
  return playerVal + pickVal + retentionBonus;
}

function theirTradeValue(){
  // This now uses the same function as above to keep values balanced
  return tradePlayerOVRValue(trade.theirPlayers) + tradePickValue(trade.theirPicks);
}

function renderTradePanel(){ 
  if(!gameStarted) return;
  trade.team = trade.team || (state.others[0] && state.others[0].name);
  // Refresh CPU trade log
  const tradeLogEl = document.getElementById('cpu-trade-log-entries');
  const tradeLogWrap = document.getElementById('cpu-trade-log');
  if(tradeLogEl && state.tradeLog && state.tradeLog.length){
    if(tradeLogWrap) tradeLogWrap.style.display = 'block';
    tradeLogEl.innerHTML = state.tradeLog.join('<br>');
  }
  renderTrade();
}

function renderTrade(){
  if(!gameStarted) return;
  const el = document.getElementById('trade-body');
  if(!el) return;
  // Expire stale CPU offers every time the trade tab is opened,
  // not just when simWeek() is called.
  expireTradeOffers();
  const tname = tradeTeamName();
  const theirTeam = state.others.find(t => t.name === tname);
  const myVal = myTradeValue();
  const theirVal = theirTradeValue();
  const diff = theirVal - myVal; // positive = we receive more

  const hasDeal = (trade.myPlayers.length || trade.myPicks.length) && (trade.theirPlayers.length || trade.theirPicks.length);
  let fairnessColor, fairnessLabel, fairnessIcon;
  if(!hasDeal){
    fairnessColor='var(--text2)'; fairnessLabel='Build your offer'; fairnessIcon='⇄';
  } else if(Math.abs(diff) < 80){
    fairnessColor='#2ecc71'; fairnessLabel='Fair deal'; fairnessIcon='✅';
  } else if(diff > 0){
    fairnessColor='#2ecc71'; fairnessLabel='You win this'; fairnessIcon='📈';
  } else {
    fairnessColor='var(--red2)'; fairnessLabel='You lose this'; fairnessIcon='📉';
  }

  // Value breakdown lines
  // Use same valuation function for breakdown display — keeps numbers consistent
  const myPlayerVal = tradePlayerOVRValue(trade.myPlayers);
  const myPickVal = tradePickValue(trade.myPicks);
  const theirPlayerVal = tradePlayerOVRValue(trade.theirPlayers);
  const theirPickVal = tradePickValue(trade.theirPicks);

  // Filter helpers
  const fmy = tradeFilter.my;
  const fth = tradeFilter.their;
  function applyFilter(roster, f, excludeIds){
    return roster.filter(p=>{
      if(excludeIds.includes(p.id)) return false;
      if(f.q && !p.name.toLowerCase().includes(f.q.toLowerCase())) return false;
      if(f.pos && p.pos !== f.pos) return false;
      if(f.minOvr && p.ovr < parseInt(f.minOvr)) return false;
      return true;
    }).sort((a,b)=>b.ovr-a.ovr);
  }

  // Build full org roster: NHL + AHL + ECHL with league tag
  const myOrgRoster = [
    ...state.myTeam.roster.map(p=>({...p, _league:'NHL'})),
    ...(state.ahl&&state.ahl.roster ? state.ahl.roster.map(p=>({...p, _league:'AHL'})) : []),
    ...(state.echl&&state.echl.roster ? state.echl.roster.map(p=>({...p, _league:'ECHL'})) : []),
  ];
  const theirOrgRoster = theirTeam ? [
    ...theirTeam.roster.map(p=>({...p, _league:'NHL'})),
    ...(theirTeam.cpuAHL&&theirTeam.cpuAHL.roster ? theirTeam.cpuAHL.roster.map(p=>({...p, _league:'AHL'})) : []),
    ...(theirTeam.cpuECHL&&theirTeam.cpuECHL.roster ? theirTeam.cpuECHL.roster.map(p=>({...p, _league:'ECHL'})) : []),
  ] : [];
  const myFiltered  = applyFilter(myOrgRoster, fmy, trade.myPlayers);
  const theirFiltered = theirTeam ? applyFilter(theirOrgRoster, fth, trade.theirPlayers) : [];
  const positions = ['C','LW','RW','LD','RD','G'];

  function chipHtml(p, side){
    const cls = side==='my' ? 'my-chip' : 'their-chip';
    const fn  = side==='my' ? `removeTradeMy` : `removeTradeTheir`;
    const retainPct = (side==='my' && trade.myRetain[p.id]) || 0;
    const retainHtml = side==='my' ? `
      <div style="margin-top:5px;display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text2);">
        <span>Retain salary:</span>
        ${[0,10,15,25,50].map(pct => `
          <button onclick="event.stopPropagation();setRetain('${p.id}',${pct})"
            style="padding:1px 7px;border-radius:4px;font-size:11px;cursor:pointer;
              background:${retainPct===pct?'var(--gold)':'var(--card)'};
              color:${retainPct===pct?'#000':'var(--text2)'};
              border:1px solid ${retainPct===pct?'var(--gold)':'var(--border)'};">
            ${pct===0?'None':pct+'%'}
          </button>`).join('')}
        ${retainPct > 0 ? `<span style="color:var(--gold);font-weight:700;">eating $${(p.salary*retainPct/100).toFixed(2)}M</span>` : ''}
      </div>` : '';
    return `<div class="trade-chip ${cls}">
      <div class="trade-chip-info">
        <div class="trade-chip-name">${p.name}${clauseBadge(p)}</div>
        <div class="trade-chip-sub">${p.pos} · Age ${p.age} · <span style="color:${ovrColor(p.ovr)};font-family:'Barlow Condensed',sans-serif;font-weight:700;">${p.ovr} OVR</span> · ${p.years}yr $${p.salary.toFixed(2)}M${retainPct>0?` <span style="color:var(--gold)">(→$${(p.salary*(1-retainPct/100)).toFixed(2)}M to them)</span>`:''}</div>
        ${retainHtml}
      </div>
      <button class="trade-remove-btn" onclick="${fn}('${p.id}')" title="Remove">×</button>
    </div>`;
  }
  function pickChipHtml(pk, side){
    const fn = side==='my' ? `removeTradePick('my','${pk.id}')` : `removeTradePick('their','${pk.id}')`;
    return `<div class="trade-chip pick-chip">
      <div class="trade-chip-info">
        <div class="trade-chip-name">${pickLabel(pk)}</div>
        <div class="trade-chip-sub">Draft Pick · Val ${pickValueScore(pk)}</div>
      </div>
      <button class="trade-remove-btn" onclick="${fn}" title="Remove">×</button>
    </div>`;
  }
  function playerRowHtml(p, onclick, showBlock){
    const onBlock = tradeBlock.has(p.id);
    const leagueColors = { AHL:'#5dade2', ECHL:'#f39c12' };
    const lc = leagueColors[p._league] || null;
    const leagueBadge = lc
      ? `<span style="font-size:10px;font-family:'Barlow Condensed',sans-serif;font-weight:700;padding:1px 5px;border-radius:3px;background:${lc}22;color:${lc};border:1px solid ${lc}55;margin-left:3px;">${p._league}</span>`
      : '';
    return `<div class="trade-player-row${onBlock?' on-block':''}" onclick="${onclick}">
      ${onBlock?'<span class="block-dot" title="On Trade Block"></span>':''}
      <span class="trade-player-row-name">${p.name}${leagueBadge}${clauseBadge(p)}</span>
      <span style="font-size:11px;color:var(--text2);">${p.pos} · ${p.age}y</span>
      <span style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:13px;color:${ovrColor(p.ovr)}">${p.ovr}</span>
      <span style="font-size:11px;color:var(--text2);">$${p.salary.toFixed(1)}M</span>
      ${showBlock?`<button class="trade-block-toggle${onBlock?' on-block-active':''}" onclick="event.stopPropagation();toggleTradeBlock('${p.id}')" title="${onBlock?'Remove from block':'Put on trade block'}">${onBlock?'★ Block':'☆ Block'}</button>`:''}
    </div>`;
  }
  function filterBar(side){
    const f = side==='my' ? fmy : fth;
    return `<div class="trade-filter-bar">
      <input type="text" placeholder="Search…" value="${f.q||''}" oninput="tradeFilter.${side}.q=this.value;renderTrade()" />
      <select onchange="tradeFilter.${side}.pos=this.value;renderTrade()">
        <option value="">All Pos</option>
        ${positions.map(pos=>`<option value="${pos}"${f.pos===pos?' selected':''}>${pos}</option>`).join('')}
      </select>
      <select onchange="tradeFilter.${side}.minOvr=this.value;renderTrade()">
        <option value="">Any OVR</option>
        ${[60,65,70,75,80,85].map(v=>`<option value="${v}"${f.minOvr==v?' selected':''}>${v}+</option>`).join('')}
      </select>
    </div>`;
  }

  const myPicks   = getTeamPicks(state.myTeam.name).filter(pk=>!trade.myPicks.find(p=>p.id===pk.id));
  const theirPicks = getTeamPicks(tname).filter(pk=>!trade.theirPicks.find(p=>p.id===pk.id));

  // ── Incoming CPU offers banner ──────────────────────────────────
  const pendingOffers = (state.pendingCPUTrades || []);
  let incomingHtml = '';
  if(pendingOffers.length > 0){
    incomingHtml = `<div style="margin-bottom:18px;">
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:800;color:#5dade2;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:10px;display:flex;align-items:center;gap:8px;">
        <span>📬 Incoming Trade Offers</span>
        <span style="background:var(--red2);color:#fff;font-size:11px;padding:1px 7px;border-radius:9px;">${pendingOffers.length}</span>
      </div>`;

    pendingOffers.forEach(function(offer, idx){
      const fairPct = Math.round(offer.targetVal / offer.totalReturnVal * 100);
      const fairColor = fairPct >= 90 ? '#2ecc71' : fairPct >= 75 ? 'var(--gold)' : 'var(--red2)';
      const fairLabel = fairPct >= 95 ? 'Strong offer' : fairPct >= 85 ? 'Fair offer' : fairPct >= 75 ? 'Below market' : 'Low-ball';

      // "You Send" tile — player or pick
      let youSendHtml = '';
      if(offer.isPickOffer){
        const myPk = state.pickInventory && state.pickInventory.find(p => p.id === offer.targetPickId);
        const pkVal = myPk ? pickValueScore(myPk) : offer.targetVal;
        youSendHtml = `<div style="display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid rgba(231,76,60,0.35);border-radius:5px;background:rgba(231,76,60,0.05);">
          <span style="font-size:18px;">🎟</span>
          <div>
            <div style="font-weight:600;font-size:13px;">${offer.targetPickLabel || offer.targetName}</div>
            <div style="font-size:11px;color:var(--text2);">Draft Pick · Val ${pkVal}</div>
          </div>
        </div>`;
      } else {
        // Target player details
        const targetPlayer = findInMyOrg(offer.targetId);
        const targetOvrColor = targetPlayer ? ovrColor(targetPlayer.ovr) : 'var(--text)';
        const targetPos = targetPlayer ? targetPlayer.pos : '?';
        const targetAge = targetPlayer ? targetPlayer.age : '?';
        const targetSalary = targetPlayer ? `$${targetPlayer.salary.toFixed(2)}M` : '';
        const targetYears = targetPlayer ? `${targetPlayer.years}yr` : '';
        youSendHtml = `<div style="display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid rgba(231,76,60,0.35);border-radius:5px;background:rgba(231,76,60,0.05);">
          <span style="font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:18px;color:${targetOvrColor};min-width:28px;text-align:center;">${targetPlayer ? targetPlayer.ovr : '?'}</span>
          <div>
            <div style="font-weight:600;font-size:13px;">${offer.targetName}</div>
            <div style="font-size:11px;color:var(--text2);">${targetPos} · Age ${targetAge} · ${targetSalary} · ${targetYears}</div>
          </div>
        </div>`;
      }

      // Return player details
      const rp = offer.returnPlayer;
      let rpCardHtml = '';
      if(rp){
        const rpOvrColor = ovrColor(rp.ovr);
        rpCardHtml = `<div style="display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--border);border-radius:5px;background:rgba(255,255,255,0.03);">
          <span style="font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:18px;color:${rpOvrColor};min-width:28px;text-align:center;">${rp.ovr}</span>
          <div>
            <div style="font-weight:600;font-size:13px;">${rp.name}</div>
            <div style="font-size:11px;color:var(--text2);">${rp.pos} · Age ${rp.age} · $${rp.salary.toFixed(2)}M · ${rp.years}yr</div>
          </div>
        </div>`;
      }
      const pickChipsHtml = offer.returnPicks.map(function(pk){
        const lbl = pickLabel(pk);
        const val = pickValueScore(pk);
        return `<span style="display:inline-flex;flex-direction:column;padding:4px 10px;border:1px solid rgba(243,156,18,0.35);border-radius:5px;background:rgba(243,156,18,0.06);"><span style="font-size:12px;font-weight:600;color:var(--gold);">🎟 ${lbl}</span><span style="font-size:10px;color:var(--text2);">Val ${val}</span></span>`;
      }).join('');

      if(!rp && pickNames.length === 0){
        rpCardHtml = `<span style="font-size:12px;color:var(--text2);font-style:italic;">No return assets specified</span>`;
      }

      incomingHtml += `<div style="padding:14px 16px;border:1px solid rgba(41,128,185,0.35);border-radius:8px;background:rgba(41,128,185,0.05);margin-bottom:10px;">
        <!-- Header row -->
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span style="font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:800;color:#fff;">${offer.offerorName}</span>
            <span style="font-size:11px;color:var(--text2);">wants</span>
            <span style="font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:800;color:var(--red2);">${offer.targetName}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:11px;color:var(--text2);">${offer.dateLabel}</span>
            ${(()=>{
              if(offer.sentDay != null){
                const daysLeft = 6 - (calSeasonDay(state.calendar) - offer.sentDay);
                const expColor = daysLeft <= 1 ? 'var(--red2)' : daysLeft <= 3 ? 'var(--gold)' : 'var(--text2)';
                return `<span style="font-size:11px;color:${expColor};">⏳ Expires in ${Math.max(0,daysLeft)}d</span>`;
              }
              return '';
            })()}
            <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;color:${fairColor};border:1px solid ${fairColor}33;background:${fairColor}11;">${fairLabel} · ${fairPct}%</span>
          </div>
        </div>

        <!-- Trade layout: their target → your return -->
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          <!-- You send -->
          <div style="flex:1;min-width:160px;">
            <div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:5px;">You Send</div>
            ${youSendHtml}
          </div>
          <!-- Arrow -->
          <div style="font-size:18px;color:var(--text2);padding-top:16px;">⇄</div>
          <!-- You receive -->
          <div style="flex:1;min-width:160px;">
            <div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:5px;">You Receive</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
              ${rpCardHtml}
              ${pickChipsHtml}
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="btn btn-gold" style="padding:5px 16px;font-size:12px;" onclick="acceptIncomingOffer(${idx})">✓ Accept</button>
          <button class="btn btn-red" style="padding:5px 16px;font-size:12px;" onclick="declineIncomingOffer(${idx})">✗ Decline</button>
          <span style="font-size:11px;color:var(--text2);">Your player: <span style="color:var(--red2);font-weight:600;">${Math.round(offer.targetVal)}</span> · Their return: <span style="color:#2ecc71;font-weight:600;">${Math.round(offer.totalReturnVal)}</span></span>
        </div>
      </div>`;
    });
    incomingHtml += '</div>';
  }

  el.innerHTML = incomingHtml + `
  <div style="display:grid;grid-template-columns:1fr 80px 1fr;gap:12px;align-items:start;">

    <!-- ===== MY SIDE ===== -->
    <div>
      <div class="trade-col-header">📤 ${state.myTeam.name} Sends</div>

      <!-- Selected chips -->
      <div style="min-height:36px;">
        ${trade.myPlayers.map(id=>{const p=findInMyOrg(id);return p?chipHtml(p,'my'):''}).join('')}
        ${trade.myPicks.map(pk=>pickChipHtml(pk,'my')).join('')}
        ${!trade.myPlayers.length&&!trade.myPicks.length?'<div style="font-size:12px;color:var(--text2);font-style:italic;padding:4px 0 8px;">Nothing selected yet</div>':''}
      </div>

      <!-- Value bar -->
      <div class="trade-val-bar" style="margin-bottom:12px;">
        <div style="flex:1;">
          <div class="trade-section-label">Sending Value</div>
          <div class="trade-val-num" style="color:var(--ice);">${Math.round(myVal)}</div>
        </div>
        ${trade.myPlayers.length||trade.myPicks.length?`<div style="font-size:11px;color:var(--text2);line-height:1.8;">
          ${trade.myPlayers.length?`<div>Players: ${myPlayerVal}</div>`:''}
          ${trade.myPicks.length?`<div>Picks: ${myPickVal}</div>`:''}
        </div>`:''}
      </div>

      <!-- Player browser -->
      <div class="trade-section-label">Add Player</div>
      ${filterBar('my')}
      <div class="trade-player-list">
        ${myFiltered.length ? myFiltered.map(p=>playerRowHtml(p,`addTradeMy('${p.id}')`,true)).join('') : '<div style="padding:10px;font-size:12px;color:var(--text2);">No players match</div>'}
      </div>

      <!-- Pick browser -->
      ${myPicks.length?`<div class="trade-section-label" style="margin-top:10px;">Add Draft Pick</div>
      <div class="trade-pick-list">
        ${myPicks.map(pk=>{
          const onBlock = pickBlock.has(pk.id);
          return `<div class="trade-pick-row${onBlock?' on-block':''}" onclick="addTradePick('my','${pk.id}')">
            ${onBlock?'<span class="block-dot" title="On Trade Block"></span>':''}
            <span style="font-weight:600;">${pickLabel(pk)}</span>
            <span style="font-size:11px;color:var(--text2);">Val ${pickValueScore(pk)}</span>
            <button class="trade-block-toggle${onBlock?' on-block-active':''}" onclick="event.stopPropagation();togglePickBlock('${pk.id}')" title="${onBlock?'Remove from block':'Put on trade block'}">${onBlock?'★ Block':'☆ Block'}</button>
          </div>`;
        }).join('')}
      </div>`:''}
    </div>

    <!-- ===== CENTER ===== -->
    <div class="trade-center-col">
      <div style="font-size:28px;">${fairnessIcon}</div>
      <div class="trade-fairness-badge" style="color:${fairnessColor};border-color:${fairnessColor};">${fairnessLabel}</div>
      ${hasDeal?`<div class="trade-value-breakdown">
        <div style="color:var(--ice);font-weight:600;">${Math.round(myVal)}</div>
        <div style="font-size:10px;margin:-2px 0;">vs</div>
        <div style="color:var(--ice);font-weight:600;">${Math.round(theirVal)}</div>
        ${diff!==0?`<div style="color:${diff>0?'#2ecc71':'var(--red2)'};font-size:10px;margin-top:4px;">${diff>0?'+':''}${Math.round(diff)} for you</div>`:''}
      </div>`:''}
    </div>

    <!-- ===== THEIR SIDE ===== -->
    <div>
      <div class="trade-col-header">📥 Receive From</div>
      <div class="team-select-wrap" style="margin-bottom:10px;">
        <select onchange="changeTradeteam(this.value)">
          ${state.others.map(t=>`<option value="${t.name}"${t.name===tname?' selected':''}>${t.name}</option>`).join('')}
        </select>
      </div>

      <!-- Selected chips -->
      <div style="min-height:36px;">
        ${trade.theirPlayers.map(id=>{const p=theirOrgRoster.find(x=>x.id===id);return p?chipHtml(p,'their'):''}).join('')}
        ${trade.theirPicks.map(pk=>pickChipHtml(pk,'their')).join('')}
        ${!trade.theirPlayers.length&&!trade.theirPicks.length?'<div style="font-size:12px;color:var(--text2);font-style:italic;padding:4px 0 8px;">Nothing selected yet</div>':''}
      </div>

      <!-- Value bar -->
      <div class="trade-val-bar" style="margin-bottom:12px;">
        <div style="flex:1;">
          <div class="trade-section-label">Receiving Value</div>
          <div class="trade-val-num" style="color:var(--ice);">${Math.round(theirVal)}</div>
        </div>
        ${trade.theirPlayers.length||trade.theirPicks.length?`<div style="font-size:11px;color:var(--text2);line-height:1.8;">
          ${trade.theirPlayers.length?`<div>Players: ${theirPlayerVal}</div>`:''}
          ${trade.theirPicks.length?`<div>Picks: ${theirPickVal}</div>`:''}
        </div>`:''}
      </div>

      <!-- Player browser -->
      <div class="trade-section-label">Add Player</div>
      ${filterBar('their')}
      <div class="trade-player-list">
        ${theirFiltered.length ? theirFiltered.map(p=>{
          const theirBlock = theirTeam && theirTeam.tradeBlock && theirTeam.tradeBlock.playerIds;
          const onTheirBlock = theirBlock && theirBlock.has(p.id);
          const leagueColors = { AHL:'#5dade2', ECHL:'#f39c12' };
          const lc = leagueColors[p._league] || null;
          const leagueBadge = lc
            ? `<span style="font-size:10px;font-family:'Barlow Condensed',sans-serif;font-weight:700;padding:1px 5px;border-radius:3px;background:${lc}22;color:${lc};border:1px solid ${lc}55;margin-left:3px;">${p._league}</span>`
            : '';
          const blockBadge = onTheirBlock
            ? `<span style="font-size:10px;font-family:'Barlow Condensed',sans-serif;font-weight:700;padding:1px 5px;border-radius:3px;background:rgba(243,156,18,0.15);color:var(--gold);border:1px solid rgba(243,156,18,0.4);margin-left:3px;" title="On Trade Block">🏷️ Block</span>`
            : '';
          return `<div class="trade-player-row${onTheirBlock?' on-block':''}" onclick="addTradeTheir('${p.id}')">
            ${onTheirBlock?'<span class="block-dot" title="On Trade Block"></span>':''}
            <span class="trade-player-row-name">${p.name}${leagueBadge}${blockBadge}${clauseBadge(p)}</span>
            <span style="font-size:11px;color:var(--text2);">${p.pos} · ${p.age}y</span>
            <span style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:13px;color:${ovrColor(p.ovr)}">${p.ovr}</span>
            <span style="font-size:11px;color:var(--text2);">$${p.salary.toFixed(1)}M</span>
          </div>`;
        }).join('') : '<div style="padding:10px;font-size:12px;color:var(--text2);">No players match</div>'}
      </div>

      <!-- Pick browser -->
      ${theirPicks.length?`<div class="trade-section-label" style="margin-top:10px;">Add Draft Pick</div>
      <div class="trade-pick-list">
        ${theirPicks.map(pk=>{
          const theirBlock = theirTeam && theirTeam.tradeBlock && theirTeam.tradeBlock.pickIds;
          const onTheirPickBlock = theirBlock && theirBlock.has(pk.id);
          return `<div class="trade-pick-row${onTheirPickBlock?' on-block':''}" onclick="addTradePick('their','${pk.id}')">
            ${onTheirPickBlock?'<span class="block-dot" title="On Trade Block"></span>':''}
            <span style="font-weight:600;">${pickLabel(pk)}</span>
            <span style="font-size:11px;color:var(--text2);">Val ${pickValueScore(pk)}</span>
            ${onTheirPickBlock?`<span style="font-size:10px;font-family:'Barlow Condensed',sans-serif;font-weight:700;padding:1px 5px;border-radius:3px;background:rgba(243,156,18,0.15);color:var(--gold);border:1px solid rgba(243,156,18,0.4);" title="On Trade Block">🏷️ Block</span>`:''}
          </div>`;
        }).join('')}
      </div>`:''}
    </div>
  </div>

  <!-- Trade Block section -->
  ${(tradeBlock.size || pickBlock.size)?`<div style="margin-top:14px;padding:10px 14px;border:1px solid rgba(243,156,18,0.3);border-radius:6px;background:rgba(243,156,18,0.04);">
    <div class="trade-section-label" style="color:var(--gold);margin-bottom:8px;">🏷️ My Trade Block (${tradeBlock.size + pickBlock.size})</div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${[...tradeBlock].map(id=>{
        const p=findInMyOrg(id);
        if(!p) return '';
        const demand = tradeBlockDemands[id] || 'any';
        const demandOpts = [
          {val:'any',         label:'Any return'},
          {val:'players_only',label:'Players only'},
          {val:'picks_only',  label:'Picks only'},
          {val:'r1_only',     label:'1st round picks only'},
          {val:'player_and_pick', label:'Player + pick'},
        ];
        return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 10px;border-radius:5px;border:1px solid rgba(243,156,18,0.25);background:rgba(243,156,18,0.06);">
          <div style="flex:1;min-width:120px;cursor:pointer;" onclick="addTradeMy('${id}')" title="Click to add to trade">
            <span style="font-weight:600;font-size:13px;">${p.name}</span>
            <span style="font-size:11px;color:${ovrColor(p.ovr)};margin-left:4px;">${p.ovr}</span>
            <span style="font-size:11px;color:var(--text2);margin-left:4px;">${p.pos} · $${p.salary.toFixed(1)}M</span>
          </div>
          <div style="display:flex;align-items:center;gap:5px;">
            <span style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:0.6px;">Wants:</span>
            <select onchange="setBlockDemand('${id}',this.value)" style="font-size:11px;padding:2px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);background:var(--bg2);color:var(--text);cursor:pointer;">
              ${demandOpts.map(o=>`<option value="${o.val}"${demand===o.val?' selected':''}>${o.label}</option>`).join('')}
            </select>
          </div>
          <button onclick="event.stopPropagation();toggleTradeBlock('${id}')" style="font-size:10px;padding:2px 7px;border-radius:3px;border:1px solid rgba(231,76,60,0.4);background:rgba(231,76,60,0.08);color:var(--red2);cursor:pointer;">✕ Remove</button>
        </div>`;
      }).join('')}
      ${[...pickBlock].map(id=>{
        const pk=getTeamPicks(state.myTeam.name).find(p=>p.id===id);
        if(!pk) return '';
        const demand = tradeBlockDemands[id] || 'any';
        const demandOpts = [
          {val:'any',         label:'Any return'},
          {val:'players_only',label:'Players only'},
          {val:'picks_only',  label:'Picks only'},
          {val:'r1_only',     label:'1st round picks only'},
          {val:'player_and_pick', label:'Player + pick'},
        ];
        return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 10px;border-radius:5px;border:1px solid rgba(243,156,18,0.25);background:rgba(243,156,18,0.06);">
          <div style="flex:1;min-width:120px;cursor:pointer;" onclick="addTradePick('my','${id}')" title="Click to add to trade">
            <span style="font-size:13px;">🎟</span>
            <span style="font-weight:600;font-size:13px;">${pickLabel(pk)}</span>
            <span style="font-size:11px;color:var(--text2);margin-left:4px;">Val ${pickValueScore(pk)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:5px;">
            <span style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:0.6px;">Wants:</span>
            <select onchange="setBlockDemand('${id}',this.value)" style="font-size:11px;padding:2px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);background:var(--bg2);color:var(--text);cursor:pointer;">
              ${demandOpts.map(o=>`<option value="${o.val}"${demand===o.val?' selected':''}>${o.label}</option>`).join('')}
            </select>
          </div>
          <button onclick="event.stopPropagation();togglePickBlock('${id}')" style="font-size:10px;padding:2px 7px;border-radius:3px;border:1px solid rgba(231,76,60,0.4);background:rgba(231,76,60,0.08);color:var(--red2);cursor:pointer;">✕ Remove</button>
        </div>`;
      }).join('')}
    </div>
    <div style="font-size:11px;color:var(--text2);margin-top:8px;">Click a player or pick to add them to the current trade proposal.</div>
  </div>`:''}

  <!-- Cap Impact Preview -->
  ${hasDeal ? (() => {
    const outFull = trade.myPlayers.reduce((s,id) => { const p=findInMyOrg(id); return s+(p?p.salary:0); }, 0);
    const outRetained = trade.myPlayers.reduce((s,id) => {
      const p = findInMyOrg(id); if(!p) return s;
      const retainPct = trade.myRetain[id] || 0;
      return s + (p.salary * retainPct / 100);
    }, 0);
    const inSal = trade.theirPlayers.reduce((s,id) => {
      const p = theirOrgRoster.find(x=>x.id===id);
      return s + (p ? p.salary : 0);
    }, 0);
    // net change: lose outFull from roster, gain inSal, but keep outRetained as dead cap
    const netCapChange = inSal - outFull + outRetained;
    const capAfter = capLeft() + netCapChange;
    return `<div style="margin-top:12px;padding:10px 14px;border:1px solid var(--border);border-radius:6px;background:rgba(255,255,255,0.02);font-size:12px;">
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px;">Cap Impact Preview</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;">
        <div><span style="color:var(--text2);">Current space: </span><span style="font-weight:600;">$${capLeft().toFixed(2)}M</span></div>
        <div style="color:var(--text2);">→</div>
        <div><span style="color:var(--text2);">After trade: </span><span style="font-weight:700;color:${capAfter<4?'var(--red2)':capAfter<10?'var(--gold)':'#2ecc71'};">$${capAfter.toFixed(2)}M</span></div>
        ${outRetained > 0 ? `<div style="color:var(--gold);margin-left:4px;">💰 Eating <strong>$${outRetained.toFixed(2)}M/yr</strong> retained on your cap</div>` : ''}
      </div>
    </div>`;
  })() : ''}

  <!-- Actions -->
  <div class="trade-actions">
    <button class="btn btn-gold" onclick="proposeTrade()">Propose Trade</button>
    <button class="btn" onclick="clearTrade()">Clear Trade</button>
    <span id="trade-msg" style="font-size:12px;color:var(--text2);"></span>
  </div>`;
}

function toggleTradeBlock(id){
  if(tradeBlock.has(id)){ tradeBlock.delete(id); delete tradeBlockDemands[id]; }
  else { tradeBlock.add(id); tradeBlockDemands[id] = tradeBlockDemands[id] || 'any'; }
  renderTrade();
}

function togglePickBlock(id){
  if(pickBlock.has(id)){ pickBlock.delete(id); delete tradeBlockDemands[id]; }
  else { pickBlock.add(id); tradeBlockDemands[id] = tradeBlockDemands[id] || 'any'; }
  renderTrade();
}

function setBlockDemand(id, val){
  tradeBlockDemands[id] = val;
  renderTrade();
}

function changeTradeteam(name){
  trade.team = name;
  trade.theirPlayers = [];
  trade.theirPicks = [];
  renderTrade();
}
function addTradeMy(id){ if(!trade.myPlayers.includes(id)) trade.myPlayers.push(id); renderTrade(); }
function addTradeTheir(id){ if(!trade.theirPlayers.includes(id)) trade.theirPlayers.push(id); renderTrade(); }
function removeTradeMy(id){ trade.myPlayers=trade.myPlayers.filter(x=>x!==id); renderTrade(); }
function removeTradeTheir(id){ trade.theirPlayers=trade.theirPlayers.filter(x=>x!==id); renderTrade(); }
function addTradePick(side, pickId){
  const pk = state.pickInventory.find(p=>p.id===pickId);
  if(!pk) return;
  if(side==='my'){ if(!trade.myPicks.find(p=>p.id===pickId)) trade.myPicks.push(pk); }
  else { if(!trade.theirPicks.find(p=>p.id===pickId)) trade.theirPicks.push(pk); }
  renderTrade();
}
function removeTradePick(side, pickId){
  if(side==='my') trade.myPicks = trade.myPicks.filter(p=>p.id!==pickId);
  else trade.theirPicks = trade.theirPicks.filter(p=>p.id!==pickId);
  renderTrade();
}
function clearTrade(){ trade.myPlayers=[]; trade.myPicks=[]; trade.theirPlayers=[]; trade.theirPicks=[]; trade.myRetain={}; renderTrade(); }

function proposeTrade(){
  const msg = document.getElementById('trade-msg');
  const tname = tradeTeamName();
  const theirTeam = state.others.find(t=>t.name===tname);
  if(!theirTeam){ msg.textContent='Select a team.'; return; }
  const theirOrgRoster = [
    ...theirTeam.roster,
    ...(theirTeam.cpuAHL&&theirTeam.cpuAHL.roster ? theirTeam.cpuAHL.roster : []),
    ...(theirTeam.cpuECHL&&theirTeam.cpuECHL.roster ? theirTeam.cpuECHL.roster : []),
  ];
  if(!trade.myPlayers.length && !trade.myPicks.length){ msg.textContent='Add at least one player or pick to send.'; return; }
  if(!trade.theirPlayers.length && !trade.theirPicks.length){ msg.textContent='Add at least one player or pick to receive.'; return; }
  // Check NMC/NTC on players being traded away (search all org rosters)
  for(const id of trade.myPlayers){
    const p = findInMyOrg(id);
    if(p){ const check = canTrade(p, tname); if(!check.allowed){ msg.textContent=`🚫 ${check.reason}`; return; } }
  }

  const myVal = myTradeValue();
  const theirVal = theirTradeValue();
  const diff = myVal - theirVal; // positive = we're giving more
  // acceptance: diff = myVal - theirVal (positive = we give more)
  // auto-accept if we give up ≤80 more than we get (fair zone)
  // soft-accept if we give ≤200 more (40% chance) — CPU values continuity / cap relief too
  // wild-card: 6% chance CPU just likes the deal
  const accepted = diff >= -80 || (diff >= -200 && Math.random()<0.4) || Math.random()<0.06;

  if(!accepted){ msg.textContent=`❌ ${tname} declined — offer more value.`; return; }

  // Execute trade
  // Players from my org (NHL/AHL/ECHL) go to their NHL roster; their players come to my NHL roster
  const myPlayerNames = trade.myPlayers.map(id=>{
    const p = findInMyOrg(id);
    if(p){
      const retainPct = trade.myRetain[id] || 0;
      if(retainPct > 0){
        const retainedAmt = Math.round(p.salary * retainPct / 100 * 1000) / 1000;
        p._retainedBy = state.myTeam.name;
        p._retainedAmt = retainedAmt; // stays on my cap permanently
        p.salary = Math.round((p.salary - retainedAmt) * 1000) / 1000; // their cap hit
        p.capPct = salaryToCapPct(p.salary);
        // My team owes retainedAmt per year for remaining contract — log it
        if(!state.myTeam.retainedContracts) state.myTeam.retainedContracts = [];
        state.myTeam.retainedContracts.push({ name:p.name, id:p.id, amt:retainedAmt, years:p.years });
        state.log.push(`💰 Retained $${retainedAmt.toFixed(2)}M/yr on ${p.name} for ${p.years} yr(s)`);
      }
      snapshotMidSeasonStats(p, state.myTeam.name);
      removeFromMyOrg(id);
      theirTeam.roster.push(p);
    }
    return p ? p.name : '';
  });
  const theirPlayerNames = trade.theirPlayers.map(id=>{
    const p = theirOrgRoster.find(x=>x.id===id);
    if(p){
      snapshotMidSeasonStats(p, tname);
      // Remove from whichever roster they're actually on
      if(theirTeam.roster.find(x=>x.id===id)) theirTeam.roster = theirTeam.roster.filter(x=>x.id!==id);
      else if(theirTeam.cpuAHL&&theirTeam.cpuAHL.roster) theirTeam.cpuAHL.roster = theirTeam.cpuAHL.roster.filter(x=>x.id!==id);
      else if(theirTeam.cpuECHL&&theirTeam.cpuECHL.roster) theirTeam.cpuECHL.roster = theirTeam.cpuECHL.roster.filter(x=>x.id!==id);
      state.myTeam.roster.push(p);
    }
    return p ? p.name : '';
  });

  // Transfer pick ownership in inventory
  trade.myPicks.forEach(pk=>{
    const inv = state.pickInventory.find(p=>p.id===pk.id);
    if(inv) inv.ownerTeam = tname;
  });
  trade.theirPicks.forEach(pk=>{
    const inv = state.pickInventory.find(p=>p.id===pk.id);
    if(inv) inv.ownerTeam = state.myTeam.name;
  });

  const sent = [...myPlayerNames.filter(Boolean), ...trade.myPicks.map(pk=>pickLabel(pk))].join(', ');
  const recv = [...theirPlayerNames.filter(Boolean), ...trade.theirPicks.map(pk=>pickLabel(pk))].join(', ');
  autoSetLines();
  state.log.push(`📦 TRADE with ${tname} — Sent: ${sent} | Received: ${recv}`);
  const retainedThisTrade = (state.myTeam.retainedContracts||[]).slice(-trade.myPlayers.length).reduce((s,r)=>s+(r.amt||0),0);
  const flashBody = retainedThisTrade > 0
    ? `Deal done with ${tname} · 💰 $${retainedThisTrade.toFixed(2)}M/yr retained on your cap`
    : `Deal done with ${tname}`;
  showFlash('Trade Complete!', flashBody, 'otl');
  clearTrade();
  renderAll();
}

// ---- sign/release ----
// ---- Personality System ----
// Trait system removed

function traitContractMod(p){ return 1; }
function traitFAWillingness(p, targetTeam){ return 1; }
function traitPlayoffBoost(p){ return 0; }
function traitInjuryMod(p){ return 0; }
function logPlayerTraits(players){}

// ---- Stats System ----
function freshStats(pos){
  if(pos === 'G'){
    return { gp:0, w:0, l:0, ga:0, saves:0, sa:0 };
  }
  return { gp:0, g:0, a:0, pm:0 }; // gp, goals, assists, plus/minus
}

function freshPlayoffStats(pos){
  if(pos === 'G') return { gp:0, w:0, l:0, ga:0, saves:0, sa:0 };
  return { gp:0, g:0, a:0, pm:0 };
}

function getPlayoffStatLine(p){
  if(!p.playoffStats) p.playoffStats = freshPlayoffStats(p.pos);
  return p.playoffStats;
}

// Career totals structure — separate from season stats
function freshCareerTotals(pos){
  if(pos === 'G') return { gp:0, w:0, l:0, ga:0, saves:0, sa:0 };
  return { gp:0, g:0, a:0, pm:0 };
}

// Archive a player's current season stats into their history, update career totals
function archivePlayerSeason(p, season, teamName){
  if(!p.stats) return;
  if(!p.seasonHistory) p.seasonHistory = [];
  if(!p.careerTotals) p.careerTotals = freshCareerTotals(p.pos);

  // Build season record
  const record = { season, team: teamName, ...p.stats };
  p.seasonHistory.push(record);

  // Update career totals
  Object.keys(p.careerTotals).forEach(key => {
    p.careerTotals[key] = (p.careerTotals[key] || 0) + (p.stats[key] || 0);
  });

  console.log(`[Career] Season ${season} stats archived for ${p.name} — ${p.pos==='G'
    ? `${p.stats.w||0}W ${p.stats.l||0}L`
    : `${p.stats.g||0}G ${p.stats.a||0}A ${(p.stats.g||0)+(p.stats.a||0)}PTS`}`);

  // Reset current season stats
  p.stats = freshStats(p.pos);
}

// Archive all players on a team at season end
function archiveTeamSeasonStats(team, season){
  if(!team || !team.roster) return;
  team.roster.forEach(p => archivePlayerSeason(p, season, team.name));
}

// Snapshot a player's mid-season stats when they change teams.
// Saves the stats earned so far this season under the old team name,
// updates career totals, then resets p.stats for the new team stint.
// Only fires if the player has actually played games (gp > 0).
function snapshotMidSeasonStats(p, oldTeamName){
  if(!p || !p.stats) return;
  const gp = p.stats.gp || 0;
  if(gp === 0) return; // nothing to snapshot yet
  if(!p.seasonHistory) p.seasonHistory = [];
  if(!p.careerTotals)  p.careerTotals  = freshCareerTotals(p.pos);
  const season = state ? state.season : 1;
  // Mark as a mid-season trade entry so the UI can show "(trade)" annotation
  const record = { season, team: oldTeamName, traded: true, ...p.stats };
  p.seasonHistory.push(record);
  Object.keys(p.careerTotals).forEach(key => {
    p.careerTotals[key] = (p.careerTotals[key] || 0) + (p.stats[key] || 0);
  });
  p.stats = freshStats(p.pos);
}

function getStatLine(p){
  if(!p.stats) p.stats = freshStats(p.pos);
  return p.stats;
}

function calcSV(p){ // save percentage
  const s = getStatLine(p);
  return s.sa > 0 ? (s.saves/s.sa) : 0;
}

function calcGAA(p){ // goals against average
  const s = getStatLine(p);
  return s.gp > 0 ? (s.ga/s.gp).toFixed(2) : '0.00';
}

function calcPTS(p){
  const s = getStatLine(p);
  return (s.g||0) + (s.a||0);
}

// Assign goals/assists to random players on a team for a given goal count
function assignGoalsToTeam(team, goals, isMyTeam, mg, og){
  if(!team.roster.length) return;
  const skaters = team.roster.filter(p=>p.pos!=='G');
  const goalies = team.roster.filter(p=>p.pos==='G');

  // A. Handle Skaters (Goals and Assists)
  if(goals > 0) {
    for(let i=0; i<goals; i++){
      const scorer = weightedPick(skaters, 'shootingAccuracy');
      if(scorer){
        getStatLine(scorer).g++;
      }
      const numAssists = Math.random()<0.15 ? 1 : Math.random()<0.5 ? 2 : 1;
      const helpers = skaters.filter(p=>p!==scorer);
      for(let j=0; j<Math.min(numAssists,helpers.length); j++){
        const helper = weightedPick(helpers, 'passing');
        if(helper) getStatLine(helper).a++;
      }
    }
  }

  // B. Handle Goalie (GP, Saves, W/L)
  if(goalies.length){
    // Determine which goalie plays (75% starter, 25% backup)
    const useStarter = Math.random() * 100 < (league.starterSharePct || 75);
    const goalie = (useStarter || goalies.length === 1) ? goalies[0] : goalies[1];
    
    const saves = rnd(18, 35);
    const s = getStatLine(goalie);
    
    s.ga += goals;
    s.saves += saves;
    s.sa += goals + saves;
    s.gp = (s.gp || 0) + 1; // THE ONLY GP ADDITION

    // Win/Loss logic
    const teamWon = (isMyTeam && mg > og) || (!isMyTeam && og > mg);
    if(teamWon) s.w = (s.w||0)+1; else s.l = (s.l||0)+1;
  }
}

function assignPlusMinus(team, goalsFor, goalsAgainst){
  // Top 6 forwards and top 4 D roughly track +/-
  const skaters = [...team.roster].filter(p=>p.pos!=='G')
    .sort((a,b)=>b.ovr-a.ovr).slice(0,10);
  skaters.forEach(p=>{
    getStatLine(p).pm += goalsFor - goalsAgainst;
  });
}

function weightedPick(players, attr){
  if(!players.length) return null;
  // Use specific attribute for weighting if available, else fall back to OVR
  const total = players.reduce((s,p)=>s + (p.attrs&&attr ? (p.attrs[attr]||p.ovr) : p.ovr), 0);
  let r = Math.random()*total;
  for(const p of players){
    r -= (p.attrs&&attr ? (p.attrs[attr]||p.ovr) : p.ovr);
    if(r<=0) return p;
  }
  return players[players.length-1];
}

function resetSeasonStats(team){
  team.roster.forEach(p=>{ p.stats = freshStats(p.pos); });
}

// Shared dev profile generator — used by newPlayer, newFAPlayer, and newProspect
function generateDevProfile(){
  const roll = Math.random();
  if(roll < 0.05)       return { label:'Exceptional Talent', readinessAge:rnd(18,20), peakAge:rnd(20,23), rate:'fast',   failChance:0.05 };
  else if(roll < 0.15)  return { label:'Fast Developer',     readinessAge:rnd(19,21), peakAge:rnd(22,24), rate:'fast',   failChance:0.10 };
  else if(roll < 0.50)  return { label:'Normal Developer',   readinessAge:rnd(21,23), peakAge:rnd(24,27), rate:'normal', failChance:0.20 };
  else if(roll < 0.75)  return { label:'Slow Developer',     readinessAge:rnd(22,25), peakAge:rnd(26,29), rate:'slow',   failChance:0.25 };
  else if(roll < 0.90)  return { label:'Late Bloomer',       readinessAge:rnd(24,27), peakAge:rnd(27,31), rate:'slow',   failChance:0.30 };
  else                  return { label:'Project',            readinessAge:rnd(25,28), peakAge:rnd(28,32), rate:'slow',   failChance:0.45 };
}

function newFAPlayer(ovrOverride){
  // Tiered OVR: mostly 70-74 depth, rare high-end FA capped at 80
  let ovr;
  if(ovrOverride){
    ovr = ovrOverride;
  } else {
    const roll = rnd(1, 100);
    if(roll <= 10)       ovr = rnd(78, 80);
    else if(roll <= 35)  ovr = rnd(74, 78);
    else if(roll <= 75)  ovr = rnd(70, 74);
    else                 ovr = rnd(65, 70);
  }
  const age = rnd(22, 34);
  const pos = pick(POSITIONS);
  const archetype = pickArchetype(pos);
  const attrs = genAttributes(pos, ovr, archetype);
  const sal = Math.max(league.minSalary, salFromOVR(ovr));
  const pct = salaryToCapPct(sal);

  // Young FAs (under 25) get developmental traits
  let devVariance = null;
  let trueGrade = null;
  let gradeRevealed = true; // FAs are known quantities — grade visible to all teams
  if(age < 25){
    devVariance = generateDevProfile();
    const trueCeilOVR = Math.min(99, ovr + rnd(2, 12));
    trueGrade = potentialGrade(trueCeilOVR);
  }

  return {
    id: Math.random().toString(36).slice(2,9),
    name: pname(), pos, ovr, age,
    salary: sal, capPct: pct, years: 1,
    archetype, attrs,
    stats: freshStats(pos),
    playoffStats: freshPlayoffStats(pos),
    seasonHistory: [],
    careerTotals: freshCareerTotals(pos),
    devVariance,
    trueGrade,
    gradeRevealed,
    isDraftee: false,
  };
}

// ----------------------------------------------------------------
// NMC / NTC CLAUSE SYSTEM
// NMC = No-Movement Clause: can't be traded or sent to minors
// NTC = No-Trade Clause: submits list of 10 blocked teams
// Modified NMC = NMC for first N years, then converts to NTC
// ----------------------------------------------------------------

// Determine what clause (if any) a player demands
function playerClauseDemand(p, offeredYrs){
  // Only veterans on multi-year deals demand clauses
  if(p.isELC) return null;
  if(offeredYrs < 2) return null;

  const roll = rnd(1,100);
  // Full NMC: elite players 30+ on long deals
  if(p.ovr >= 90 && p.age >= 30 && offeredYrs >= 4 && roll <= 70) return 'NMC';
  if(p.ovr >= 88 && p.age >= 32 && offeredYrs >= 3 && roll <= 60) return 'NMC';
  // Modified NMC: stars 28+ wanting security
  if(p.ovr >= 87 && p.age >= 28 && offeredYrs >= 4 && roll <= 55) return 'M-NMC';
  if(p.ovr >= 85 && p.age >= 30 && offeredYrs >= 3 && roll <= 45) return 'M-NMC';
  // NTC: solid players wanting some control
  if(p.ovr >= 83 && p.age >= 27 && offeredYrs >= 3 && roll <= 40) return 'NTC';
  if(p.ovr >= 80 && p.age >= 30 && offeredYrs >= 2 && roll <= 25) return 'NTC';
  return null;
}

// Generate a random NTC blocked team list (10 teams player won't go to)
function generateNTCList(){
  const teams = [...TEAM_NAMES].filter(n=>n!==state.myTeam.name);
  const shuffled = teams.sort(()=>Math.random()-0.5);
  return shuffled.slice(0,10);
}

// Check if player can be traded
function canTrade(p, targetTeamName){
  if(!p.clause) return { allowed:true };
  if(p.clause==='NMC') return { allowed:false, reason:`${p.name} has a No-Movement Clause and cannot be traded.` };
  if(p.clause==='M-NMC'){
    // NMC for first half of contract, NTC for second half
    const nmcYears = Math.ceil(p.clauseYears / 2);
    const yearsServed = p.clauseYears - p.years;
    if(yearsServed < nmcYears) return { allowed:false, reason:`${p.name} has a Modified NMC (${nmcYears - yearsServed} NMC year${nmcYears-yearsServed>1?'s':''} remaining).` };
    // NTC phase — check blocked teams
    if(p.ntcList && targetTeamName && p.ntcList.includes(targetTeamName))
      return { allowed:false, reason:`${p.name}'s NTC blocks a trade to ${targetTeamName}.` };
  }
  if(p.clause==='NTC'){
    if(p.ntcList && targetTeamName && p.ntcList.includes(targetTeamName))
      return { allowed:false, reason:`${p.name}'s No-Trade Clause blocks a trade to ${targetTeamName}.` };
  }
  return { allowed:true };
}

// Can be sent to minors?
function canSendToMinors(p){
  if(!p.clause) return { allowed:true };
  if(p.clause==='NMC') return { allowed:false, reason:`${p.name} has a No-Movement Clause and cannot be sent to the minors.` };
  if(p.clause==='M-NMC'){
    const nmcYears = Math.ceil(p.clauseYears / 2);
    const yearsServed = p.clauseYears - p.years;
    if(yearsServed < nmcYears) return { allowed:false, reason:`${p.name} has a Modified NMC — cannot be sent down yet.` };
  }
  return { allowed:true };
}

// Clause badge for UI
function clauseBadge(p){
  let badges = '';
  if(p.isTwoWay){
    badges += `<span title="Two-Way Contract — minor salary: $${p.minorSalary ? p.minorSalary.toFixed(2) : '?'}M" style="font-size:10px;font-family:'Barlow Condensed',sans-serif;font-weight:700;padding:1px 5px;border-radius:3px;background:rgba(41,128,185,0.18);color:#5dade2;border:1px solid rgba(41,128,185,0.4);cursor:help;margin-left:4px;">2-WAY</span>`;
  }
  if(!p.clause) return badges;
  const colors = { NMC:'#e74c3c', 'M-NMC':'#f39c12', NTC:'#5dade2' };
  const c = colors[p.clause] || 'var(--text2)';
  badges += `<span title="${p.clause==='NMC'?'No-Movement Clause':p.clause==='M-NMC'?'Modified NMC':'No-Trade Clause'}" style="font-size:10px;font-family:'Barlow Condensed',sans-serif;font-weight:700;padding:1px 5px;border-radius:3px;background:${c}22;color:${c};border:1px solid ${c}55;cursor:help;margin-left:4px;">${p.clause}</span>`;
  return badges;
}

function playerAsk(p){
  const base = salFromOVR(p.ovr);
  const wantYears = p.age <= 28 ? Math.min(8, contractYears(p.ovr, p.age)) : Math.max(1, contractYears(p.ovr, p.age));
  const clause = playerClauseDemand(p, wantYears);
  return { salary: base, years: wantYears, clause };
}

function contractAcceptance(p, offeredSal, offeredYrs, isTwoWay){
  const ask = playerAsk(p);
  // Two-way contract: NHL-caliber players refuse outright.
  // OVR 80+ flat refuse. OVR 75-79 refuse unless desperate (age 33+, or role-player archetype).
  // OVR 70-74 are reluctant but might accept with a solid salary.
  if(isTwoWay){
    if(p.ovr >= 80){
      return { accepts: false, mood: "❌ Won't accept a two-way deal." };
    }
    if(p.ovr >= 75){
      const desperate = p.age >= 33 || ['Grinder','Enforcer','Defensive Forward'].includes(p.archetype);
      if(!desperate) return { accepts: false, mood: '❌ Expects a one-way contract.' };
    }
    if(p.ovr >= 70){
      const traitMod = traitContractMod(p);
      const adjustedAsk = ask.salary * traitMod;
      if(offeredSal / adjustedAsk < 0.9) return { accepts: false, mood: '😐 Hesitant — wants one-way or more money.' };
    }
  }
  // Trait modifies how picky the player is
  const traitMod = traitContractMod(p);
  const adjustedAsk = ask.salary * traitMod;
  const salRatio = offeredSal / adjustedAsk;
  const yrDiff = offeredYrs - ask.years;
  const will = traitFAWillingness(p, state.myTeam);
  // Mercenary/Greedy harder to please, Loyal easier
  const threshold = will > 1.2 ? 1.05 : will < 0.8 ? 0.85 : 0.95;
  if(salRatio >= threshold && yrDiff >= -1) return { accepts: true, mood: '😄 Happy to sign!' };
  if(salRatio >= threshold-0.15 && yrDiff >= -2) return { accepts: true, mood: '🤝 Accepts the offer.' };
  if(salRatio >= threshold-0.25 && yrDiff >= -1) return { accepts: Math.random()<0.5*will, mood: '😐 Considering...' };
  return { accepts: false, mood: '❌ Wants more.' };
}

function buildYearBreakdown(sal, yrs, startSeason, startAge){
  let rows = '';
  for(let i=0; i<yrs; i++){
    const yr = startSeason + i;
    const age = startAge + i;
    const projCap = Math.round((league.salaryCap + i*3)*10)/10;
    const pct = (sal/projCap*100).toFixed(2);
    rows += `<div style="display:flex;align-items:center;padding:7px 12px;border-bottom:1px solid rgba(100,160,220,0.07);${i===0?'background:rgba(41,128,185,0.05);':''}">
      <div style="flex:1;color:${i===0?'var(--ice)':'var(--text2)'};">Season ${yr} ${i===0?'<span style="font-size:10px;color:var(--accent);">(current)</span>':''}</div>
      <div style="width:40px;text-align:center;color:var(--text2);font-size:11px;">Age ${age}</div>
      <div style="width:80px;text-align:right;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:15px;">$${sal.toFixed(2)}M</div>
      <div style="width:60px;text-align:right;color:var(--text2);font-size:11px;">${pct}%</div>
    </div>`;
  }
  return rows;
}

function updateContractPreview(){
  if(!signTarget) return;
  const sal = Math.max(0.775, parseFloat(document.getElementById('sign-salary').value)||0);
  const yrs = Math.max(1, Math.min(8, parseInt(document.getElementById('sign-years').value)||1));
  const pct = salaryToCapPct(sal);
  document.getElementById('sign-cap-pct').textContent = pct.toFixed(2);
  document.getElementById('contract-total').textContent = `$${(sal*yrs).toFixed(2)}M`;
  // Year breakdown
  const breakdown = document.getElementById('contract-year-breakdown');
  if(breakdown) breakdown.innerHTML = buildYearBreakdown(sal, yrs, state.season, signTarget.age);
  // Cap after
  const capAfter = capLeft() - sal;
  const capEl = document.getElementById('contract-cap-left');
  capEl.textContent = `$${capAfter.toFixed(2)}M`;
  capEl.style.color = capAfter < 0 ? 'var(--red2)' : '#2ecc71';
  // Asking
  const ask = playerAsk(signTarget);
  const clauseStr = ask.clause ? ` + ${ask.clause}` : '';
  document.getElementById('contract-asking').textContent = `$${ask.salary.toFixed(2)}M / yr — ${ask.years} year${ask.years>1?'s':''}${clauseStr} (${salaryToCapPct(ask.salary).toFixed(2)}% cap)`;
  // Reaction
  const isTwoWayPreview = !!(document.getElementById('sign-twoway-toggle') && document.getElementById('sign-twoway-toggle').checked);
  const { mood } = contractAcceptance(signTarget, sal, yrs, isTwoWayPreview);
  const reactionEl = document.getElementById('contract-reaction');
  reactionEl.textContent = mood;
  const isGood = mood.startsWith('😄')||mood.startsWith('🤝');
  const isMid = mood.startsWith('😐');
  reactionEl.style.background = isGood?'rgba(46,204,113,0.1)':isMid?'rgba(243,156,18,0.1)':'rgba(192,57,43,0.1)';
  reactionEl.style.color = isGood?'#2ecc71':isMid?'var(--gold)':'var(--red2)';
}

function openSign(id){
  signTarget = state.fa.find(p=>p.id===id) || state.myTeam.roster.find(p=>p.id===id);
  if(!signTarget) return;
  // Ensure required fields exist (affiliate callups may be missing these)
  if(signTarget.salary == null) signTarget.salary = Math.max(league.minSalary, salFromOVR(signTarget.ovr));
  if(signTarget.years  == null) signTarget.years  = 1;
  // Draftees being signed for the first time are a special mode
  window._resignMode = !!signTarget._myTeam;
  window._elcSignMode = !!signTarget.isDraftedByMe;
  const ask = playerAsk(signTarget);
  document.getElementById('contract-title').textContent = window._resignMode ? 'Re-Sign Player' : 'Make Offer';
  document.getElementById('sign-info').innerHTML = `<strong>${signTarget.name}</strong> &nbsp;·&nbsp; ${signTarget.pos} &nbsp;·&nbsp; Age ${signTarget.age} &nbsp;·&nbsp; OVR ${signTarget.ovr}${signTarget.potential ? ` &nbsp;·&nbsp; Pot <span class="prospect-potential pot-${signTarget.potential}">${signTarget.potential}</span>` : ''}`;
  if(isELCEligible(signTarget)){
    document.getElementById('sign-salary').value = ELC.maxSalary.toFixed(3);
    document.getElementById('sign-salary').max = ELC.maxSalary;
    document.getElementById('sign-years').value = ELC.maxYears;
    document.getElementById('sign-years').min = ELC.maxYears;
    document.getElementById('sign-years').max = ELC.maxYears;
    document.getElementById('sign-years-max').textContent = ELC.maxYears;
    document.getElementById('sign-warn').textContent = `ELC: max $${ELC.maxSalary}M / ${ELC.maxYears} years (mandatory)`;
  } else {
    document.getElementById('sign-salary').value = ask.salary.toFixed(3);
    document.getElementById('sign-salary').max = 14;
    document.getElementById('sign-years').value = ask.years;
    document.getElementById('sign-years').max = 8;
    document.getElementById('sign-years-max').textContent = 8;
    document.getElementById('sign-warn').textContent = '';
  }
  updateContractPreview();
  signClause = null;
  setSignClause(null);
  resetSignTwoWay();
  // Hide two-way option for ELC players (they're always one-way)
  const twSection = document.getElementById('sign-twoway-section');
  if(twSection) twSection.style.display = isELCEligible(signTarget) ? 'none' : 'block';

  // Show competing CPU offers on this player
  const competing = (state.cpuPendingOffers || []).filter(o => o.id === signTarget.id);
  const compWrap = document.getElementById('sign-competing-offers');
  if(compWrap){
    if(competing.length){
      compWrap.style.display = 'block';
      compWrap.innerHTML = `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text2);margin-bottom:6px;">⚠️ Other Teams Offering</div>`
        + competing.map(o => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
          <span style="color:#fff;">${o.teamName}</span>
          <span style="color:var(--gold);">$${o.salary.toFixed(1)}M / ${o.yrs || o.years}yr</span>
        </div>`).join('');
    } else {
      compWrap.style.display = 'none';
      compWrap.innerHTML = '';
    }
  }

  document.getElementById('modal-sign').classList.add('open');
}

function confirmSign(){
  const p = signTarget;
  const yrs = parseInt(document.getElementById('sign-years').value);
  const sal = parseFloat(document.getElementById('sign-salary').value);
  const isTwoWay = !!(document.getElementById('sign-twoway-toggle') && document.getElementById('sign-twoway-toggle').checked);
  if(sal > capLeft()+0.05){
    document.getElementById('sign-warn').textContent = 'Not enough cap space!'; return;
  }
  const { accepts, mood } = contractAcceptance(p, sal, yrs, isTwoWay);
  // Draftees always accept their ELC — it's a league-mandated contract structure
  if(!accepts && !window._elcSignMode){
    document.getElementById('sign-warn').textContent = mood + ' Increase your offer.'; return;
  }
  if(window._elcSignMode){
    // Signing a freshly drafted player to their first ELC — always 3 years, mandatory
    p.years = ELC.maxYears;
    p.salary = sal;
    p.capPct = salaryToCapPct(sal);
    p.isELC = true;
    p.isDraftedByMe = false; // ELC now in place, no longer "unsigned draftee"
    clearFloorAdjustments(state.myTeam);
    state.log.push(`✍️ Signed ${p.name} to ELC — ${ELC.maxYears}yr @ $${sal.toFixed(2)}M`);
    window._elcSignMode = false;
    window._resignMode = false;
    closeModal('modal-sign');
    renderResign();
    return;
  }
  if(window._resignMode){
    const minorSalary = isTwoWay ? Math.max(0.075, parseFloat(document.getElementById('sign-minor-salary').value)||0.375) : null;
    p.years = yrs;
    p.salary = sal;
    p.capPct = salaryToCapPct(sal);
    p.isELC = false;
    p._resigned = true;
    p._myTeam = false;
    p.isTwoWay = isTwoWay;
    p.minorSalary = minorSalary;
    p.nhlSalary = sal;
    delete p.elcJustExpired;
    state.fa = state.fa.filter(x => x.id !== p.id);
    state.myTeam.roster.push(p);
    clearFloorAdjustments(state.myTeam);
    const twLogStr = (p.isTwoWay && p.minorSalary) ? ` [2-WAY @ $${p.minorSalary.toFixed(2)}M minors]` : '';
    state.log.push(`✍️ Re-signed ${p.name} (OVR ${p.ovr}) — ${yrs}yr @ $${sal.toFixed(2)}M${twLogStr}`);
    console.log(`[Player] ${p.name} re-signed with ${state.myTeam.name} — $${sal.toFixed(2)}M/${yrs}yr`);
    window._resignMode = false;
    closeModal('modal-sign');
    renderResign();
    return;
  }

  // Queue as a pending offer — player (and competing CPU offers) resolve on next sim day
  if(!state.faPendingOffers) state.faPendingOffers = [];
  // Replace any existing pending offer for this player
  state.faPendingOffers = state.faPendingOffers.filter(o => o.id !== p.id);
  const minorSalOffer = isTwoWay ? Math.max(0.075, parseFloat(document.getElementById('sign-minor-salary').value)||0.375) : null;
  state.faPendingOffers.push({
    id: p.id, name: p.name, pos: p.pos, ovr: p.ovr, age: p.age,
    sal, yrs,
    isELC: !!(isELCEligible(p) && sal <= ELC.maxSalary + 0.001 && yrs <= ELC.maxYears),
    isTwoWay: isTwoWay,
    minorSalary: minorSalOffer,
    nhlSalary: sal,
  });
  // Player stays in state.fa — removed when offer is accepted on sim day
  closeModal('modal-sign');
  const inFAPhase = state.calendar && state.calendar.phase === PHASES.FREE_AGENCY;
  const waitMsg = inFAPhase ? 'Sim a day to hear back.' : 'Sim a day or week to hear back.';
  showFlash('Offer Made!', `${p.name} is considering your offer. ${waitMsg}`, 'otl');
  renderAll();
}

// ---- extend (roster players) ----
let extendTarget = null;
function openExtend(id){
  extendTarget = state.myTeam.roster.find(p=>p.id===id);
  if(!extendTarget) return;
  // Block extensions on ELC players
  if(isELC(extendTarget)){
    alert(`${extendTarget.name} is on an Entry Level Contract (ELC) and cannot be extended until it expires.`);
    return;
  }
  const ask = playerAsk(extendTarget);
  document.getElementById('extend-info').innerHTML = `<strong>${extendTarget.name}</strong> &nbsp;·&nbsp; ${extendTarget.pos} &nbsp;·&nbsp; Age ${extendTarget.age} &nbsp;·&nbsp; OVR ${extendTarget.ovr} &nbsp;·&nbsp; <span style="color:var(--text2);">${extendTarget.years}yr remaining — extension adds on top</span>`;
  document.getElementById('extend-salary').value = ask.salary.toFixed(3);
  document.getElementById('extend-years').value = ask.years;
  document.getElementById('extend-warn').textContent = '';
  updateExtendPreview();
  extendClause = null;
  setExtendClause(null);
  resetExtendTwoWay();
  document.getElementById('modal-extend').classList.add('open');
}

function updateExtendPreview(){
  if(!extendTarget) return;
  const sal = Math.max(0.775, parseFloat(document.getElementById('extend-salary').value)||0);
  const yrs = Math.max(1, Math.min(8, parseInt(document.getElementById('extend-years').value)||1));
  const pct = salaryToCapPct(sal);
  document.getElementById('extend-cap-pct').textContent = pct.toFixed(2);
  document.getElementById('extend-total').textContent = `$${(sal*yrs).toFixed(2)}M`;
  // Year breakdown — starts after current contract ends
  const breakdown = document.getElementById('extend-year-breakdown');
  if(breakdown) breakdown.innerHTML = buildYearBreakdown(sal, yrs, state.season + extendTarget.years, extendTarget.age + extendTarget.years);
  // Cap after
  const capAfter = capLeft() - sal;
  const capEl = document.getElementById('extend-cap-left');
  capEl.textContent = `$${capAfter.toFixed(2)}M`;
  capEl.style.color = capAfter < 0 ? 'var(--red2)' : '#2ecc71';
  // Asking
  const ask = playerAsk(extendTarget);
  const extClauseStr = ask.clause ? ` + ${ask.clause}` : '';
  document.getElementById('extend-asking').textContent = `$${ask.salary.toFixed(2)}M / yr — ${ask.years} year${ask.years>1?'s':''}${extClauseStr} (${salaryToCapPct(ask.salary).toFixed(2)}% cap)`;
  // Reaction
  const isTwoWayExtPreview = !!(document.getElementById('extend-twoway-toggle') && document.getElementById('extend-twoway-toggle').checked);
  const { mood } = contractAcceptance(extendTarget, sal, yrs, isTwoWayExtPreview);
  const reactionEl = document.getElementById('extend-reaction');
  reactionEl.textContent = mood;
  const isGood = mood.startsWith('😄')||mood.startsWith('🤝');
  const isMid = mood.startsWith('😐');
  reactionEl.style.background = isGood?'rgba(46,204,113,0.1)':isMid?'rgba(243,156,18,0.1)':'rgba(192,57,43,0.1)';
  reactionEl.style.color = isGood?'#2ecc71':isMid?'var(--gold)':'var(--red2)';

}

function confirmExtend(){
  if(!extendTarget) return;
  const sal = parseFloat(document.getElementById('extend-salary').value);
  const yrs = parseInt(document.getElementById('extend-years').value);
  const isTwoWayExt = !!(document.getElementById('extend-twoway-toggle') && document.getElementById('extend-twoway-toggle').checked);
  if(sal > capLeft() + extendTarget.salary + 0.05){
    document.getElementById('extend-warn').textContent = 'Not enough cap space!'; return;
  }
  const { accepts, mood } = contractAcceptance(extendTarget, sal, yrs, isTwoWayExt);
  if(!accepts){
    document.getElementById('extend-warn').textContent = mood + ' Increase your offer.'; return;
  }
  const minorSalExt = isTwoWayExt ? Math.max(0.075, parseFloat(document.getElementById('extend-minor-salary').value)||0.375) : null;
  // Store the new deal as a pending extension — salary/clause kick in after
  // the current contract expires, not immediately. Years are added now so
  // the player stays on the roster through the full term.
  const originalYears = extendTarget.years;
  extendTarget.pendingExtension = {
    salary: sal,
    capPct: salaryToCapPct(sal),
    years: yrs,
    clause: extendClause || null,
    clauseYears: extendClause ? yrs : 0,
    ntcList: (extendClause==='NTC'||extendClause==='M-NMC') ? generateNTCList() : null,
    isTwoWay: isTwoWayExt,
    minorSalary: minorSalExt,
    nhlSalary: sal,
  };
  extendTarget.years = originalYears + yrs;
  extendClause = null;
  const extClauseStr = extendTarget.pendingExtension.clause ? ` [${extendTarget.pendingExtension.clause}]` : '';
  const twStr = isTwoWayExt ? ` [2-WAY @ $${minorSalExt.toFixed(2)}M minors]` : '';
  state.log.push(`📝 Extended ${extendTarget.name} (OVR ${extendTarget.ovr}) — ${originalYears}yr @ $${extendTarget.salary.toFixed(2)}M current, then ${yrs}yr @ $${sal.toFixed(2)}M${extClauseStr}${twStr}`);
  closeModal('modal-extend');
  showFlash('Extended!', `${extendTarget.name} signed a new deal.`, 'otl');
  renderAll();
}
function openRelease(id){
  releaseTarget = state.myTeam.roster.find(p=>p.id===id);
  document.getElementById('release-info').innerHTML = `<strong>${releaseTarget.name}</strong> (${releaseTarget.pos}, OVR ${releaseTarget.ovr}, $${releaseTarget.salary.toFixed(1)}M/yr)`;
  document.getElementById('modal-release').classList.add('open');
}
function confirmRelease(){
  const p = releaseTarget;
  state.myTeam.roster = state.myTeam.roster.filter(x=>x.id!==p.id);
  state.fa.push({...p, years:1});
  autoSetLines();
  state.log.push(`🗑️ Released ${p.name} (OVR ${p.ovr}) — cap cleared`);
  closeModal('modal-release');
  renderAll();
}
function closeModal(id){
  const modal = document.getElementById(id);
  if(!modal) return;
  modal.classList.remove('open');
  if(modal.style.display === 'flex') modal.style.display = 'none';
  if(id === 'modal-sign') { window._resignMode = false; window._elcSignMode = false; resetSignTwoWay(); }
  if(id === 'modal-extend') { resetExtendTwoWay(); }
}

function showPauseMenu(){
  document.getElementById('modal-pause').classList.add('open');
}

function quitToMainMenu(){
  saveGame();
  closeModal('modal-pause');
  showMenu();
}
// ---- game sim ----
function simOneGame(myTeam, oppTeam, homeBoost=0, awayBoost=0){
  const myBase = (myTeam.name===state.myTeam.name && state.lines ? linesEffectiveness() : teamOVR(myTeam.roster)) + homeBoost;
  const oppBase = (oppTeam.name===state.myTeam.name && state.lines ? linesEffectiveness() : teamOVR(oppTeam.roster)) + awayBoost;
  
  // STAT REALISM FIX: Lowered multipliers for better Save %
  const myStr = myBase + rnd(-10, 10);
  const oppStr = oppBase + rnd(-10, 10);
  const myAvg = 2.5 + Math.max(0,(myStr-oppStr)*0.05); 
  const oppAvg = 2.5 + Math.max(0,(oppStr-myStr)*0.05);

  let mg = Math.round(Math.max(0, myAvg + (rnd(0,10)+rnd(0,10))/5 - 2));
  let og = Math.round(Math.max(0, oppAvg + (rnd(0,10)+rnd(0,10))/5 - 2));

  let result;
  let overtime = false;
  if(mg === og){
    // Tied after regulation — go to OT/shootout
    overtime = true;
    // OT is a coin flip weighted slightly toward the stronger team
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

  const isMyHome = myTeam.name===state.myTeam.name;
  const isMyAway = oppTeam.name===state.myTeam.name;

  // IMPORTANT: We pass mg and og here so the Goalie gets the Win/Loss correctly
  assignGoalsToTeam(myTeam, mg, isMyHome, mg, og);
  assignGoalsToTeam(oppTeam, og, isMyAway, mg, og);
  
  assignPlusMinus(myTeam, mg, og);
  assignPlusMinus(oppTeam, og, mg);

  // SKATERS GP: Only give +1 to non-goalies
  myTeam.roster.forEach(p => { if(p.pos !== 'G') { let s = getStatLine(p); s.gp = (s.gp||0)+1; } });
  oppTeam.roster.forEach(p => { if(p.pos !== 'G') { let s = getStatLine(p); s.gp = (s.gp||0)+1; } });

  if (typeof incrementGP === 'undefined') {
    window.incrementGP = function(team) { /* Already handled */ };
  }

  // THIS WAS MISSING: You need to return the result and close the function
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

// ================================================================
// AUTO-SIM SYSTEM
// ================================================================
let _autoSimInterval = null;
let _autoSimSpeed    = 400; // ms per day (default: Normal)
let _autoSimSeenTradeIds = new Set(); // offer IDs already shown to player, won't re-stop

function getAutoSimSettings(){
  return {
    stopOnTrade:       document.getElementById('autosim-stop-trade')?.checked        ?? true,
    stopOnDeadline:    document.getElementById('autosim-stop-deadline')?.checked      ?? true,
    stopOnSeasonEnd:   document.getElementById('autosim-stop-season-end')?.checked    ?? true,
    stopOnPlayoffs:    document.getElementById('autosim-stop-playoffs')?.checked      ?? true,
    stopOnDraft:       document.getElementById('autosim-stop-draft')?.checked         ?? true,
    stopOnWaiverClaim: document.getElementById('autosim-stop-waiver-claim')?.checked  ?? true,
    target:            document.getElementById('autosim-target')?.value               ?? '',
  };
}

function setAutoSimSpeed(ms){
  _autoSimSpeed = ms;
  // Update button highlight
  document.querySelectorAll('.autosim-speed-btn').forEach(b => {
    b.classList.toggle('active-speed', parseInt(b.dataset.speed) === ms);
  });
  // If already running, restart at new speed
  if(_autoSimInterval !== null){
    clearInterval(_autoSimInterval);
    _autoSimInterval = setInterval(_autoSimTick, _autoSimSpeed);
  }
}

function toggleAutoSim(){
  if(_autoSimInterval !== null){
    stopAutoSim();
  } else {
    startAutoSim();
  }
}

function startAutoSim(){
  if(_autoSimInterval !== null) return;
  // Mark all currently visible offers as already seen so resuming auto-sim
  // after reviewing a trade doesn't immediately stop again.
  _autoSimSeenTradeIds = new Set(
    (state.pendingCPUTrades || []).map(o => o.targetId || o.targetPickId)
  );
  const btn = document.getElementById('autosim-btn');
  if(btn){ btn.textContent = '⏹ Stop Auto-Sim'; btn.classList.add('btn-red'); btn.classList.remove('btn-gold'); }
  _autoSimInterval = setInterval(_autoSimTick, _autoSimSpeed);
}

function stopAutoSim(reason){
  if(_autoSimInterval === null) return;
  clearInterval(_autoSimInterval);
  _autoSimInterval = null;
  const btn = document.getElementById('autosim-btn');
  if(btn){ btn.textContent = '▶▶ Auto-Sim'; btn.classList.remove('btn-red'); btn.classList.add('btn-gold'); }
  if(reason) showFlash('Auto-Sim Paused', reason, 'otl');
  updateTradeOfferBadge();
}

function _autoSimTick(){
  if(!state || !state.calendar){ stopAutoSim(); return; }
  const cal   = state.calendar;
  const phase = cal.phase;
  const cfg   = getAutoSimSettings();

  // Only auto-sim during preseason, regular season, or trade deadline
  if(phase !== PHASES.PRESEASON && phase !== PHASES.REGULAR_SEASON && phase !== PHASES.TRADE_DEADLINE){
    stopAutoSim('Auto-sim paused — not in a simmable phase.');
    return;
  }

  // Check target stop
  if(cfg.target){
    const pd = PHASE_DATES;
    if(cfg.target === 'season-start' && isOnOrAfterDate(cal, 'October', 2))                                    { stopAutoSim('Regular Season has started!'); return; }
    if(cfg.target === 'deadline'    && isOnOrAfterDate(cal, pd.tradeDeadline.month,    pd.tradeDeadline.day))  { stopAutoSim('Reached the Trade Deadline.'); return; }
    if(cfg.target === 'season-end'  && isOnOrAfterDate(cal, pd.regularSeasonEnd.month, pd.regularSeasonEnd.day)){ stopAutoSim('Regular Season has ended.'); return; }
    if(cfg.target === 'draft'       && isOnOrAfterDate(cal, pd.draftDay.month,          pd.draftDay.day))        { stopAutoSim('Draft Day has arrived.'); return; }
  }

  // Trigger checks before simming
  if(cfg.stopOnDeadline  && phase === PHASES.TRADE_DEADLINE){ stopAutoSim('Trade Deadline has arrived!'); return; }
  if(cfg.stopOnSeasonEnd && isOnOrAfterDate(cal, PHASE_DATES.regularSeasonEnd.month, PHASE_DATES.regularSeasonEnd.day)){ stopAutoSim('Regular Season has ended.'); return; }

  // Check for pending incoming trade offers — only stop for ones not yet seen
  if(cfg.stopOnTrade && state.pendingCPUTrades && state.pendingCPUTrades.length > 0){
    const newOffers = state.pendingCPUTrades.filter(o => {
      const id = o.targetId || o.targetPickId;
      return !_autoSimSeenTradeIds.has(id);
    });
    if(newOffers.length > 0){
      newOffers.forEach(o => _autoSimSeenTradeIds.add(o.targetId || o.targetPickId));
      stopAutoSim('A team has sent you a trade offer!');
      showTab('trade');
      return;
    }
  }

  // All clear — sim one day
  simDay();
}

function autoSimCheckPlayoffSeries(){
  // Called externally when a playoff series involving the user ends
  const cfg = getAutoSimSettings();
  if(cfg.stopOnPlayoffs && _autoSimInterval !== null){
    stopAutoSim('Your playoff series has ended.');
  }
}

function autoSimCheckDraft(){
  const cfg = getAutoSimSettings();
  if((cfg.stopOnDraft || cfg.target === 'draft') && _autoSimInterval !== null){
    stopAutoSim('Draft Day has arrived!');
  }
}

function autoSimCheckSeasonEnd(){
  const cfg = getAutoSimSettings();
  if((cfg.stopOnSeasonEnd || cfg.target === 'season-end') && _autoSimInterval !== null){
    stopAutoSim('Regular Season has ended.');
  }
}

function autoSimCheckDeadline(){
  const cfg = getAutoSimSettings();
  if((cfg.stopOnDeadline || cfg.target === 'deadline') && _autoSimInterval !== null){
    stopAutoSim('Trade Deadline has arrived!');
  }
}

function autoSimCheckIncomingTrade(){
  const cfg = getAutoSimSettings();
  if(cfg.stopOnTrade && _autoSimInterval !== null){
    stopAutoSim('A team has sent you a trade offer!');
    showTab('trade');
  }
}

function autoSimCheckWaiverClaim(playerName, claimingTeam){
  const cfg = getAutoSimSettings();
  if(cfg.stopOnWaiverClaim && _autoSimInterval !== null){
    stopAutoSim(`${claimingTeam} claimed ${playerName} off waivers!`);
    showTab('waivers');
  }
}

function expireTradeOffers(){
  if(!state.pendingCPUTrades || !state.pendingCPUTrades.length) return;
  const currentDay = calSeasonDay(state.calendar);
  const before = state.pendingCPUTrades.length;
  state.pendingCPUTrades = state.pendingCPUTrades.filter(offer => {
    if(offer.sentDay == null) return false; // legacy offers without sentDay are treated as expired
    return (currentDay - offer.sentDay) < 7;
  });
  const expired = before - state.pendingCPUTrades.length;
  if(expired > 0){
    state.log.push(`📭 ${expired} trade offer${expired > 1 ? 's' : ''} expired.`);
  }
}

function simWeek(){
  if(!state || !state.calendar){ console.error('[simWeek] state.calendar is undefined'); return; }
  const cal = state.calendar;
  console.log(`[simWeek] Week ${cal.week} | Phase: ${cal.phase}`);
  expireTradeOffers();

  // Guard: block during offseason tasks only
  if(cal.phase === PHASES.DRAFT || cal.phase === PHASES.RESIGN ||
     cal.phase === PHASES.FREE_AGENCY || cal.phase === PHASES.OFFSEASON){
    showFlash('Offseason', 'Complete offseason tasks first.', 'otl');
    return;
  }

  // During playoffs, sim playoff games instead of the regular schedule
  if(cal.phase === PHASES.PLAYOFFS){
    const myResults = simPlayoffGamesForPeriod(3); // ~3 game slots per week
    if(myResults.length > 0){
      myResults.forEach(r => {
        const cls = r.result==='W'?'res-W':r.result==='L'?'res-L':'res-OTL';
        state.log.push(`<span class="wk">${r.monthName.slice(0,3)} ${r.day}</span><span class="${cls}">${r.result}</span> vs ${r.oppName} — ${r.myG}–${r.oppG}`);
      });
      const last = myResults[myResults.length - 1];
      const flashLabel = last.result==='W'?'Victory!':last.result==='L'?'Defeat':'Overtime Loss';
      showFlash(`Playoff Week (${myResults.length} games)`, flashLabel, last.result==='W'?'win':last.result==='L'?'loss':'otl');
    } else {
      showFlash('Playoffs', 'No games to sim — check the Playoffs tab.', 'otl');
    }
    cal.week++;
    state.week = cal.week;
    checkPhaseTransition();
    renderAll();
    return;
  }

  // Process all games this week
  const myResults = processWeekGames();

  // Log results for player's team
  if(myResults.length > 0){
    myResults.forEach(r => {
      const cls = r.result==='W'?'res-W':r.result==='L'?'res-L':'res-OTL';
      const dateStr = r.monthName && r.day ? ` ${r.monthName.slice(0,3)} ${r.day}` : ` Wk${cal.week}`;
      state.log.push(`<span class="wk">${dateStr}</span><span class="${cls}">${r.result}</span> vs ${r.oppName} — ${r.myG}–${r.oppG}`);
    });
    // Flash last result
    const last = myResults[myResults.length-1];
    const flashLabel = last.result==='W'?'Victory!':last.result==='L'?'Defeat':'Overtime Loss';
    const flashC = last.result==='W'?'win':last.result==='L'?'loss':'otl';
    showFlash(`${flashLabel} (${myResults.length} games)`, `Week ${cal.week} complete`, flashC);
  } else {
    state.log.push(`<span class="wk">Wk${cal.week}</span> No games scheduled`);
  }

  // Resolve any pending player offers (human + CPU) each week
  resolvePendingOffers();
  resolveCpuOffers();

  // Track NHL games played for waiver exemption calculations (~3 game days per week)
  trackNhlGamesPlayed(3);

  // Process waivers — check for CPU claims and clear pending entries
  processWaivers();

  // Mid-season CPU roster management — fill holes and opportunistic upgrades
  cpuManageRosters('inseason');

  // CPU teams update their trade blocks weekly based on cap/roster/standing
  cpuUpdateTradeBlocks();

  // CPU vs CPU trades — buyers pursue sellers at positions of need
  cpuSimulateTrades();

  // Cap floor compliance — fires once at season start (October 2nd)
  if(!cal.seasonStartFired){
    applySeasonStartFloor(cal);
  }

  // Advance calendar
  cal.week++;
  state.week = cal.week;
  // Update currentMonth/currentDay based on week
  // Each week = 7 days from season start (Oct 1)
  const dayOfSeason = (cal.week - 1) * 7;
  let rem = dayOfSeason;
  for(let m=0; m<SEASON_MONTHS.length; m++){
    if(rem < SEASON_MONTHS[m].days){ cal.currentMonth=m; cal.currentDay=rem+1; break; }
    rem -= SEASON_MONTHS[m].days;
  }
  // Keep calendar view in sync with today
  cal.viewMonth = cal.currentMonth;
  cal.viewYear = cal.currentMonth >= 3 ? cal.year + 1 : cal.year;

  // Check for phase transitions
  checkPhaseTransition();

  renderAll();
  if(document.querySelector('.tab-btn.active')?.textContent.trim()==='Game Log') showTab('log');
}

// ----------------------------------------------------------------
// SIM SEASON — fast-forward entire regular season
// ----------------------------------------------------------------
// ---- Sim Day ----
// Advances exactly one calendar day, simulating only the games
// scheduled on that specific date (Tue/Thu/Sat game days) or
// skipping to the next day if no games are scheduled today.
function simDay(){
  if(!state || !state.calendar){ return; }
  const cal = state.calendar;

  // Guard: block during offseason tasks only
  if(cal.phase === PHASES.DRAFT || cal.phase === PHASES.RESIGN ||
     cal.phase === PHASES.FREE_AGENCY || cal.phase === PHASES.OFFSEASON){
    showFlash('Offseason', 'Complete offseason tasks first.', 'otl');
    return;
  }

  // During playoffs, sim one game per active series instead of the regular schedule
  if(cal.phase === PHASES.PLAYOFFS){
    const myResults = simPlayoffGamesForPeriod(1); // 1 game slot = one playoff day
    // Advance one calendar day
    const seasonDayStart2 = SEASON_MONTHS.slice(0, cal.currentMonth).reduce((s,m)=>s+m.days,0) + (cal.currentDay - 1);
    const targetDay2 = seasonDayStart2 + 1;
    let rem3 = targetDay2, nm2 = 0, nd2 = 1;
    for(let m = 0; m < SEASON_MONTHS.length; m++){
      if(rem3 < SEASON_MONTHS[m].days){ nm2 = m; nd2 = rem3 + 1; break; }
      rem3 -= SEASON_MONTHS[m].days;
    }
    cal.currentMonth = nm2; cal.currentDay = nd2; cal.viewMonth = nm2;
    cal.viewYear = nm2 >= 3 ? cal.year + 1 : cal.year;
    const newWeek2 = Math.floor(targetDay2 / 7) + 1;
    if(newWeek2 > cal.week){ cal.week = newWeek2; state.week = cal.week; }
    const ms2 = SEASON_MONTHS[nm2].name.slice(0,3);
    if(myResults.length > 0){
      myResults.forEach(r => {
        const cls = r.result==='W'?'res-W':r.result==='L'?'res-L':'res-OTL';
        state.log.push(`<span class="wk">${ms2} ${nd2}</span><span class="${cls}">${r.result}</span> vs ${r.oppName} — ${r.myG}–${r.oppG}`);
      });
      const last = myResults[myResults.length - 1];
      showFlash(last.result==='W'?'Victory!':last.result==='L'?'Defeat':'OT Loss',
        `${ms2} ${nd2} · ${last.myG}–${last.oppG}`, last.result==='W'?'win':last.result==='L'?'loss':'otl');
    } else {
      state.log.push(`<span class="wk">${ms2} ${nd2}</span> No playoff games today`);
      showFlash(`${ms2} ${nd2}`, 'No playoff games today', 'otl');
    }
    checkPhaseTransition();
    renderAll();
    return;
  }

  // Cap floor compliance — fires once at season start (October 2nd)
  if(!cal.seasonStartFired) applySeasonStartFloor(cal);

  // Find current absolute day of season
  const seasonDayStart = SEASON_MONTHS.slice(0, cal.currentMonth).reduce((s,m)=>s+m.days,0) + (cal.currentDay - 1);

  // Always advance exactly one calendar day
  const targetSeasonDay = seasonDayStart + 1;

  // Figure out what month+day that is
  let rem2 = targetSeasonDay;
  let newMonth = 0, newDay = 1;
  for(let m = 0; m < SEASON_MONTHS.length; m++){
    if(rem2 < SEASON_MONTHS[m].days){ newMonth = m; newDay = rem2 + 1; break; }
    rem2 -= SEASON_MONTHS[m].days;
  }

  // Check if we'd cross into a new week
  const newWeek = Math.floor(targetSeasonDay / 7) + 1;
  const weekAdvanced = newWeek > cal.week;

  // Simulate only the games on targetSeasonDay's date key
  const dk = dateKey(newMonth, newDay);
  const dayGames = (state.schedule.byDate && state.schedule.byDate[dk]) || [];
  let myResults = [];

  dayGames.forEach(g => {
    if(g.result) return; // already simmed
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
      g.result = myResult; g.myG = myG; g.oppG = oppG;
      myResults.push({ result: myResult, myG, oppG, oppName, monthName: g.monthName, day: g.day });
      if(myResult==='W') state.morale = Math.min(5, state.morale+1);
      else if(myResult==='L') state.morale = Math.max(-5, state.morale-1);
    }
  });

  // Affiliate tick (once per game day)
  if(dayGames.length > 0){
    simAffiliateGame(state.ahl);
    simAffiliateGame(state.echl);
  }

  // Resolve any pending player offers (human + CPU) every game day
  resolvePendingOffers();
  resolveCpuOffers();

  // ── Advance calendar FIRST so placedDay and currentDay are in sync ──
  cal.currentMonth = newMonth;
  cal.currentDay = newDay;
  if(weekAdvanced){
    cal.week = newWeek;
    state.week = cal.week;
  }
  cal.viewMonth = newMonth;
  cal.viewYear = newMonth >= 3 ? cal.year + 1 : cal.year;

  // Track NHL games played for waiver exemption (must run on every game day)
  if(dayGames.length > 0) trackNhlGamesPlayed();

  // CPU roster management — places players on waivers stamped with today's day
  const isOff = (cal.phase === PHASES.FREE_AGENCY || cal.phase === PHASES.RESIGN || cal.phase === PHASES.OFFSEASON);
  cpuManageRosters(isOff ? 'offseason' : 'inseason');

  // CPU trades — only during regular season / deadline
  cpuSimulateTrades();

  // Process waivers AFTER cpuManageRosters so newly placed players are in the list,
  // and AFTER calendar advance so the 24-hour window check is accurate.
  // Players placed today have placedDay === currentDay, so they sit for one full day.
  if(dayGames.length > 0) processWaivers();

  // Log results
  const monthShort = SEASON_MONTHS[newMonth].name.slice(0,3);
  if(myResults.length > 0){
    myResults.forEach(r => {
      const cls = r.result==='W'?'res-W':r.result==='L'?'res-L':'res-OTL';
      state.log.push(`<span class="wk">${monthShort} ${newDay}</span><span class="${cls}">${r.result}</span> vs ${r.oppName} — ${r.myG}–${r.oppG}`);
    });
    const last = myResults[myResults.length-1];
    const flashLabel = last.result==='W'?'Victory!':last.result==='L'?'Defeat':'Overtime Loss';
    showFlash(flashLabel, `${monthShort} ${newDay} · ${last.myG}–${last.oppG}`, last.result==='W'?'win':last.result==='L'?'loss':'otl');
  } else {
    state.log.push(`<span class="wk">${monthShort} ${newDay}</span> No games`);
    showFlash(`${monthShort} ${newDay}`, 'No games today', 'otl');
  }

  checkPhaseTransition();
  renderAll();
}

// ---- Sim to Trade Deadline ----
function simToTradeDeadline(){
  const cal = state.calendar;
  const PD = PHASE_DATES;
  if(cal.phase === PHASES.PLAYOFFS || isOnOrAfterDate(cal, PD.regularSeasonEnd.month, PD.regularSeasonEnd.day + 1)){
    showFlash('Too late!', 'Trade deadline has already passed.', 'otl');
    return;
  }
  if(isOnOrAfterDate(cal, PD.tradeDeadline.month, PD.tradeDeadline.day)){
    showFlash('Already there!', 'You\'re at or past the trade deadline.', 'otl');
    return;
  }
  if(cal.phase === PHASES.DRAFT || cal.phase === PHASES.RESIGN ||
     cal.phase === PHASES.FREE_AGENCY || cal.phase === PHASES.OFFSEASON){
    showFlash('Offseason', 'Complete offseason tasks first.', 'otl');
    return;
  }

  // Sim weeks until we hit the trade deadline date
  while(!isOnOrAfterDate(cal, PD.tradeDeadline.month, PD.tradeDeadline.day)){
    const myResults = processWeekGames();
    myResults.forEach(r => {
      const cls = r.result==='W'?'res-W':r.result==='L'?'res-L':'res-OTL';
      const dateStr = r.monthName && r.day ? ` ${r.monthName.slice(0,3)} ${r.day}` : ` Wk${cal.week}`;
      state.log.push(`<span class="wk">${dateStr}</span><span class="${cls}">${r.result}</span> vs ${r.oppName} — ${r.myG}–${r.oppG}`);
      if(r.result==='W') state.morale = Math.min(5, state.morale+1);
      else if(r.result==='L') state.morale = Math.max(-5, state.morale-1);
    });

    // CPU roster management this week
    cpuManageRosters('inseason');
    cpuSimulateTrades();

    cal.week++;
    state.week = cal.week;
    // Sync currentMonth/currentDay
    let rem = (cal.week - 1) * 7;
    for(let m = 0; m < SEASON_MONTHS.length; m++){
      if(rem < SEASON_MONTHS[m].days){ cal.currentMonth = m; cal.currentDay = rem + 1; break; }
      rem -= SEASON_MONTHS[m].days;
    }
    cal.viewMonth = cal.currentMonth;
    cal.viewYear = cal.currentMonth >= 3 ? cal.year + 1 : cal.year;
  }

  checkPhaseTransition();

  // Deadline frenzy — run several extra trade attempts to simulate the deadline rush
  for(let i = 0; i < 4; i++) cpuSimulateTrades();

  const tdMonth = PHASE_DATES.tradeDeadline.month.slice(0,3);
  const tdDay   = PHASE_DATES.tradeDeadline.day;
  showFlash('Trade Deadline!', `${tdMonth} ${tdDay} — make your moves!`, 'otl');
  renderAll();
}

function simSeason(){
  const cal = state.calendar;
  const PD = PHASE_DATES;

  if(cal.phase === PHASES.PLAYOFFS || isOnOrAfterDate(cal, PD.regularSeasonEnd.month, PD.regularSeasonEnd.day + 1)){
    showFlash('Already done!', 'Regular season is over.', 'otl');
    return;
  }

  // Process every remaining regular season week (until past regularSeasonEnd date)
  const MAX_WEEKS = cal.regularSeasonWeeks + 5; // safety cap to prevent infinite loop
  let iterations = 0;
  while(!isOnOrAfterDate(cal, PD.regularSeasonEnd.month, PD.regularSeasonEnd.day + 1)){
    if(++iterations > MAX_WEEKS) break; // safety valve
    const myResults = processWeekGames();
    myResults.forEach(r => {
      const cls = r.result==='W'?'res-W':r.result==='L'?'res-L':'res-OTL';
      const dateStr = r.monthName && r.day ? ` ${r.monthName.slice(0,3)} ${r.day}` : ` Wk${cal.week}`;
      state.log.push(`<span class="wk">${dateStr}</span><span class="${cls}">${r.result}</span> vs ${r.oppName} — ${r.myG}–${r.oppG}`);
      if(r.result==='W') state.morale = Math.min(5, state.morale+1);
      else if(r.result==='L') state.morale = Math.max(-5, state.morale-1);
    });
    // Advance the week (processWeekGames does NOT do this — simWeek normally handles it)
    cal.week++;
    state.week = cal.week;
    const dayOfSeason = (cal.week - 1) * 7;
    let rem = dayOfSeason;
    for(let m = 0; m < SEASON_MONTHS.length; m++){
      if(rem < SEASON_MONTHS[m].days){ cal.currentMonth = m; cal.currentDay = rem + 1; break; }
      rem -= SEASON_MONTHS[m].days;
    }
    checkPhaseTransition();
  }

  cal.phase = PHASES.PLAYOFFS;
  // Land on April 17 (last day of regular season) so playoffs show on calendar
  const aprilIdx = SEASON_MONTHS.findIndex(m => m.name === 'April');
  cal.currentMonth = aprilIdx;
  cal.currentDay = 17;
  cal.viewMonth = aprilIdx;
  cal.viewYear = cal.year + 1; // April is in the second calendar year of the season
  state.log.push('🏒 Regular season complete — playoffs begin!');
  showFlash('Season Complete!', 'Playoffs are set!', 'otl');
  autoSimCheckSeasonEnd();
  renderAll();
  startPlayoffs();
}

// ----------------------------------------------------------------
// SIM TO DATE — sim forward to a specific calendar date
// Called when the user clicks a future day on the calendar.
// ----------------------------------------------------------------
function simToDate(targetMonthIdx, targetDay){
  const cal = state.calendar;

  // Guard: only block during offseason tasks
  if(cal.phase === PHASES.DRAFT || cal.phase === PHASES.RESIGN ||
     cal.phase === PHASES.FREE_AGENCY || cal.phase === PHASES.OFFSEASON){
    showFlash('Offseason', 'Complete offseason tasks first.', 'otl');
    return;
  }

  // (no hard stop at regular season end — let checkPhaseTransition handle it)

  // Already past or at this date?
  const targetSD = phaseDateToSeasonDay(SEASON_MONTHS[targetMonthIdx].name, targetDay);
  const todaySD  = calSeasonDay(cal);
  if(targetSD <= todaySD){
    showFlash('Already past', 'That date has already been simulated.', 'otl');
    return;
  }

  // Target week
  const targetWeek = Math.floor(targetSD / 7) + 1;

  if(targetWeek <= cal.week){
    showFlash('Current or past week', 'Use Sim Day or Sim Week for this period.', 'otl');
    return;
  }

  const weeksToSim = targetWeek - cal.week;
  const tgtMonthName = SEASON_MONTHS[targetMonthIdx].name;

  // Run weeks up to targetWeek
  let totalResults = [];
  while(cal.week < targetWeek){
    const myResults = processWeekGames();
    myResults.forEach(r => {
      const cls = r.result==='W'?'res-W':r.result==='L'?'res-L':'res-OTL';
      const dateStr = r.monthName && r.day ? ` ${r.monthName.slice(0,3)} ${r.day}` : ` Wk${cal.week}`;
      state.log.push(`<span class="wk">${dateStr}</span><span class="${cls}">${r.result}</span> vs ${r.oppName} — ${r.myG}–${r.oppG}`);
      if(r.result==='W') state.morale = Math.min(5, state.morale+1);
      else if(r.result==='L') state.morale = Math.max(-5, state.morale-1);
    });
    totalResults = totalResults.concat(myResults);

    // Advance the week
    cal.week++;
    state.week = cal.week;
    const dayOfSeason = (cal.week - 1) * 7;
    let rem = dayOfSeason;
    for(let m = 0; m < SEASON_MONTHS.length; m++){
      if(rem < SEASON_MONTHS[m].days){ cal.currentMonth = m; cal.currentDay = rem + 1; break; }
      rem -= SEASON_MONTHS[m].days;
    }
    cpuManageRosters('inseason');
    cpuSimulateTrades();
    checkPhaseTransition();
  }

  // Flash summary
  const wins  = totalResults.filter(r=>r.result==='W').length;
  const losses = totalResults.filter(r=>r.result==='L').length;
  const otls  = totalResults.filter(r=>r.result==='OTL').length;
  const flashType = wins>losses?'win':losses>wins?'loss':'otl';
  showFlash(
    `${weeksToSim} wk${weeksToSim!==1?'s':''} simmed to ${tgtMonthName} ${targetDay}`,
    totalResults.length>0 ? `${wins}W-${losses}L-${otls}OTL` : 'No games in that stretch',
    flashType
  );

  // Jump calendar view to the target month
  cal.viewMonth = targetMonthIdx;
  cal.viewYear = targetMonthIdx >= 3 ? cal.year + 1 : cal.year;
  renderAll();
  renderCalendar();
}

// ---- flash ----
function showFlash(title, body, type){
  const el = document.getElementById('flash');
  document.getElementById('flash-title').textContent = title;
  document.getElementById('flash-body').textContent = body;
  el.className = 'flash show ' + (type||'');
  if(flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.className = 'flash'; }, 3200);
}

// ---- playoffs ----
function startPlayoffs(){
  // Reset playoff stats for all players
  allTeams().forEach(team => {
    team.roster.forEach(p => { p.playoffStats = freshPlayoffStats(p.pos); });
  });
  const { playoffTeams, wildcards } = getPlayoffTeams();
  // Build bracket: per conference, seed div winners 1-3, then wildcards 4-5 (but we have 8 per conf)
  state.playoffsStarted = true;
  state.bracket = buildBracket();
  const tabPO = document.getElementById('tab-playoffs'); if(tabPO) tabPO.style.display = '';
  renderAll();
  state.log.push('🏆 Playoffs have begun!');
}

function buildBracket(){
  const bracket = { rounds: [], champion: null };
  const confSeeds = {};

  Object.entries(CONFERENCES).forEach(([conf, divs])=>{
    // Gather ALL teams in this conference, sort by points
    const allConfTeams = [];
    divs.forEach(div=>{
      const divTeams = DIVISIONS[div].map(n=>getTeamByName(n)).filter(Boolean);
      allConfTeams.push(...divTeams);
    });
    // Get top 3 from each division first
    const divTop3 = [];
    divs.forEach(div=>{
      const sorted = DIVISIONS[div].map(n=>getTeamByName(n)).filter(Boolean).sort((a,b)=>pts(b)-pts(a));
      sorted.slice(0,3).forEach(t=>divTop3.push(t));
    });
    // Wildcards: remaining conf teams sorted by pts, take top 2
    const divTop3Names = new Set(divTop3.map(t=>t.name));
    const wildcards = allConfTeams.filter(t=>!divTop3Names.has(t.name)).sort((a,b)=>pts(b)-pts(a)).slice(0,2);
    // Final 8: sort div qualifiers by pts, then wildcards
    divTop3.sort((a,b)=>pts(b)-pts(a));
    const seeds = [...divTop3, ...wildcards].slice(0,8);
    confSeeds[conf] = seeds;
  });

  // First round: 1v8, 2v7, 3v6, 4v5 per conference
  const round1 = [];
  Object.entries(confSeeds).forEach(([conf, seeds])=>{
    [[0,7],[1,6],[2,5],[3,4]].forEach(([a,b])=>{
      const home = seeds[a], away = seeds[b];
      if(home && away){
        round1.push({ conf, home: home.name, away: away.name, homeW:0, awayW:0, done:false, winner:null });
      }
    });
  });

  const playoffsBase0 = phaseDateToSeasonDay('April', 18);
  round1.forEach(s => { s.startSeasonDay = playoffsBase0; });
  bracket.rounds = [round1];
  return bracket;
}

function simPlayoffGame(homeTeam, awayTeam){
  // Like simOneGame but writes to playoffStats not regular stats
  const myBase = (homeTeam.name===state.myTeam.name && state.lines ? linesEffectiveness() : teamOVR(homeTeam.roster));
  const oppBase = (awayTeam.name===state.myTeam.name && state.lines ? linesEffectiveness() : teamOVR(awayTeam.roster));
  const myStr = myBase + rnd(-10,10);
  const oppStr = oppBase + rnd(-10,10);
  const myAvg = 2 + Math.max(0,(myStr-oppStr)*0.08);
  const oppAvg = 2 + Math.max(0,(oppStr-myStr)*0.08);
  let mg = Math.round(Math.max(0, myAvg + (rnd(0,10)+rnd(0,10))/5 - 2));
  let og = Math.round(Math.max(0, oppAvg + (rnd(0,10)+rnd(0,10))/5 - 2));

  // Playoffs: sudden death OT — no ties, no OTL, just a winner
  if(mg === og){
    const myWinsOT = Math.random() < 0.5 + (myStr - oppStr) * 0.005;
    if(myWinsOT){ mg++; } else { og++; }
  }

  // Assign playoff stats
  const isMyHome = homeTeam.name===state.myTeam.name;
  const isMyAway = awayTeam.name===state.myTeam.name;
  assignPlayoffGoals(homeTeam, mg, isMyHome);
  assignPlayoffGoals(awayTeam, og, isMyAway);
  incrementPlayoffGP(homeTeam);
  incrementPlayoffGP(awayTeam);
  // Goalie W/L
  const hG = homeTeam.roster.find(p=>p.pos==='G');
  const aG = awayTeam.roster.find(p=>p.pos==='G');
  if(hG){ if(mg>og) getPlayoffStatLine(hG).w=(getPlayoffStatLine(hG).w||0)+1; else getPlayoffStatLine(hG).l=(getPlayoffStatLine(hG).l||0)+1; }
  if(aG){ if(og>mg) getPlayoffStatLine(aG).w=(getPlayoffStatLine(aG).w||0)+1; else getPlayoffStatLine(aG).l=(getPlayoffStatLine(aG).l||0)+1; }

  let result;
  if(mg>og){ homeTeam.w++; awayTeam.l = (awayTeam.l||0)+1; result='W'; }
  else { awayTeam.w++; homeTeam.l = (homeTeam.l||0)+1; result='L'; }
  return { result, mg, og };
}

function assignPlayoffGoals(team, goals, isMyTeam){
  if(!goals || !team.roster.length) return;
  const skaters = team.roster.filter(p=>p.pos!=='G');
  const goalies = team.roster.filter(p=>p.pos==='G');
  for(let i=0;i<goals;i++){
    const scorer = weightedPick(skaters,'shootingAccuracy');
    if(scorer){ getPlayoffStatLine(scorer).g=(getPlayoffStatLine(scorer).g||0)+1; }
    const numAssists = Math.random()<0.15 ? 1 : 2;
    const helpers = skaters.filter(p=>p!==scorer);
    for(let j=0;j<Math.min(numAssists,helpers.length);j++){
      const helper = weightedPick(helpers,'passing');
      if(helper){ getPlayoffStatLine(helper).a=(getPlayoffStatLine(helper).a||0)+1; }
    }
  }
  if(goalies.length){
    const s = getPlayoffStatLine(goalies[0]);
    const saves = rnd(18,35);
    s.ga=(s.ga||0)+goals; s.saves=(s.saves||0)+saves; s.sa=(s.sa||0)+goals+saves;
  }
}

function incrementPlayoffGP(team){
  team.roster.forEach(p=>{
    if(!p.playoffStats) p.playoffStats = freshPlayoffStats(p.pos);
    p.playoffStats.gp = (p.playoffStats.gp||0)+1;
  });
}

function simSeries(series){
  // Best of 7 — uses playoff stat tracking
  // Assign a start date if not set (April 18 for round 1, or after prior round)
  if(!series.startSeasonDay){
    // Base start day on which round this series is in
    // Round 1 starts Apr 19, each subsequent round starts ~16 days later (max 7 games * 2 days + 2 rest)
    const playoffsBase = phaseDateToSeasonDay('April', 18);
    let roundIdx = 0;
    if(state.bracket){
      state.bracket.rounds.forEach((round, ri) => {
        if(round.includes(series)) roundIdx = ri;
      });
    }
    series.startSeasonDay = playoffsBase + roundIdx * 16;
  }
  if(!series.games) series.games = [];
  let gameDay = series.startSeasonDay + series.games.length * 2; // every 2 days
  while(series.homeW < 4 && series.awayW < 4){
    const home = getTeamByName(series.home);
    const away = getTeamByName(series.away);
    const g = simPlayoffGame(home, away);
    // Convert seasonDay to month+day
    let rem = gameDay;
    let gMonth = 0;
    while(gMonth < SEASON_MONTHS.length-1 && rem >= SEASON_MONTHS[gMonth].days){
      rem -= SEASON_MONTHS[gMonth].days; gMonth++;
    }
    const gDay = rem + 1;
    series.games.push({
      seasonDay: gameDay,
      month: gMonth,
      day: gDay,
      homeG: g.mg,
      awayG: g.og,
      homeWin: g.mg > g.og,
    });
    if(g.result === 'W') series.homeW++;
    else series.awayW++;
    gameDay += 2;
  }
  series.winner = series.homeW > series.awayW ? series.home : series.away;
  series.done = true;
}

function advancePlayoffs(){
  const bracket = state.bracket;
  const currentRound = bracket.rounds[bracket.rounds.length - 1];
  const allDone = currentRound.every(s => s.done);
  if(!allDone){ alert('Sim all current series first!'); return; }
  // Check if finals are done
  if(currentRound.length === 1 && allDone){
    bracket.champion = currentRound[0].winner;
    showFlash('🏆 Champion!', bracket.champion + ' wins!', 'win');
    state.log.push(`🏆 ${bracket.champion} wins the Stanley Cup!`);
    renderPlayoffs();
    return;
  }
  // Group winners by conf and advance
  const winners = currentRound.map(s => ({ conf: s.conf, name: s.winner }));
  // If 4 series (first round) -> 2 series per conf (semis), if 2 -> conf finals, if 2 conf finals -> Stanley Cup
  let nextRound = [];
  if(currentRound.length >= 4){
    // Pair up winners within each conf
    const byConf = {};
    winners.forEach(w => { if(!byConf[w.conf]) byConf[w.conf]=[]; byConf[w.conf].push(w.name); });
    Object.entries(byConf).forEach(([conf, names])=>{
      for(let i=0;i<names.length;i+=2){
        if(names[i+1]) nextRound.push({ conf, home:names[i], away:names[i+1], homeW:0, awayW:0, done:false, winner:null });
      }
    });
  } else {
    // Conference finals -> Stanley Cup final
    nextRound = [{ conf:'Final', home:winners[0].name, away:winners[1].name, homeW:0, awayW:0, done:false, winner:null }];
  }
  const newRoundIdx = bracket.rounds.length;
  const playoffsBase2 = phaseDateToSeasonDay('April', 18);
  nextRound.forEach(s => { s.startSeasonDay = playoffsBase2 + newRoundIdx * 16; });
  bracket.rounds.push(nextRound);
  renderAll();
}

function simAllSeries(){
  const bracket = state.bracket;
  const currentRound = bracket.rounds[bracket.rounds.length - 1];
  currentRound.forEach(s => { if(!s.done) simSeries(s); });
  renderPlayoffs();
}
function simOnePlayoffGame(roundIdx, seriesIdx){
  // Sim a single game of a specific series, then re-render calendar
  const bracket = state.bracket;
  if(!bracket) return;
  const round = bracket.rounds[roundIdx];
  if(!round) return;
  const series = round[seriesIdx];
  if(!series || series.done) return;

  // Set start date if needed
  if(!series.startSeasonDay){
    const playoffsBase = phaseDateToSeasonDay('April', 18);
    series.startSeasonDay = playoffsBase + roundIdx * 16;
  }
  if(!series.games) series.games = [];

  const home = getTeamByName(series.home);
  const away = getTeamByName(series.away);
  const g = simPlayoffGame(home, away);

  // Convert season day to month+day
  const gameDay = series.startSeasonDay + series.games.length * 2;
  let rem = gameDay, gMonth = 0;
  while(gMonth < SEASON_MONTHS.length-1 && rem >= SEASON_MONTHS[gMonth].days){
    rem -= SEASON_MONTHS[gMonth].days; gMonth++;
  }
  series.games.push({ seasonDay: gameDay, month: gMonth, day: rem+1, homeG: g.mg, awayG: g.og, homeWin: g.mg > g.og });

  if(g.result === 'W') series.homeW++;
  else series.awayW++;

  if(series.homeW === 4 || series.awayW === 4){
    series.winner = series.homeW > series.awayW ? series.home : series.away;
    series.done = true;
    const isMyWin = series.winner === state.myTeam.name;
    showFlash(isMyWin ? '🏒 Series Win!' : '📦 Eliminated', `${series.winner} wins the series!`, isMyWin ? 'win' : 'otl');
    // Check if whole round is done — auto-advance
    calCheckAdvanceRound();
  }
  renderCalendar();
}

function calSimWholeSeries(roundIdx, seriesIdx){
  const bracket = state.bracket;
  if(!bracket) return;
  const round = bracket.rounds[roundIdx];
  if(!round) return;
  const series = round[seriesIdx];
  if(!series || series.done) return;
  // Sim remaining games to finish it
  if(!series.startSeasonDay){
    const playoffsBase = phaseDateToSeasonDay('April', 18);
    series.startSeasonDay = playoffsBase + roundIdx * 16;
  }
  if(!series.games) series.games = [];
  let gameDay = series.startSeasonDay + series.games.length * 2;
  while(series.homeW < 4 && series.awayW < 4){
    const home = getTeamByName(series.home);
    const away = getTeamByName(series.away);
    const g = simPlayoffGame(home, away);
    let rem = gameDay, gMonth = 0;
    while(gMonth < SEASON_MONTHS.length-1 && rem >= SEASON_MONTHS[gMonth].days){
      rem -= SEASON_MONTHS[gMonth].days; gMonth++;
    }
    series.games.push({ seasonDay: gameDay, month: gMonth, day: rem+1, homeG: g.mg, awayG: g.og, homeWin: g.mg > g.og });
    if(g.result === 'W') series.homeW++;
    else series.awayW++;
    gameDay += 2;
  }
  series.winner = series.homeW > series.awayW ? series.home : series.away;
  series.done = true;
  const isMyWin = series.winner === state.myTeam.name;
  showFlash(isMyWin ? '🏒 Series Win!' : '📦 Eliminated', `${series.winner} wins the series!`, isMyWin ? 'win' : 'otl');
  calCheckAdvanceRound();
  renderCalendar();
}

function calCheckAdvanceRound(){
  const bracket = state.bracket;
  if(!bracket) return;
  const currentRound = bracket.rounds[bracket.rounds.length - 1];
  if(!currentRound.every(s => s.done)) return;
  // All done — advance or crown champion
  if(currentRound.length === 1){
    bracket.champion = currentRound[0].winner;
    showFlash('🏆 Stanley Cup Champion!', bracket.champion + ' wins!', 'win');
    state.log.push(`🏆 ${bracket.champion} wins the Stanley Cup!`);
    renderPlayoffs();
    return;
  }
  const winners = currentRound.map(s => ({ conf: s.conf, name: s.winner }));
  let nextRound = [];
  if(currentRound.length >= 4){
    const byConf = {};
    winners.forEach(w => { if(!byConf[w.conf]) byConf[w.conf]=[]; byConf[w.conf].push(w.name); });
    Object.entries(byConf).forEach(([conf, names])=>{
      for(let i=0;i<names.length;i+=2){
        if(names[i+1]) nextRound.push({ conf, home:names[i], away:names[i+1], homeW:0, awayW:0, done:false, winner:null });
      }
    });
  } else {
    nextRound = [{ conf:'Final', home:winners[0].name, away:winners[1].name, homeW:0, awayW:0, done:false, winner:null }];
  }
  const newRoundIdx2 = bracket.rounds.length;
  const playoffsBase3 = phaseDateToSeasonDay('April', 18);
  nextRound.forEach(s => { s.startSeasonDay = playoffsBase3 + newRoundIdx2 * 16; });
  bracket.rounds.push(nextRound);
  showFlash('🏒 Next Round!', 'New matchups set. Check your calendar!', 'win');
}



function renderPlayoffs(){
  if(!state || !state.myTeam || !gameStarted) return;
  const el = document.getElementById('playoffs-body');
  if(!state.bracket){
    el.innerHTML = `<div style="color:var(--text2);font-size:14px;padding:20px 0;">⏳ Complete the regular season to unlock the playoffs.</div>
    <button class="btn btn-gold" style="margin-top:12px;" onclick="startPlayoffs()">Force Generate Bracket</button>`;
    return;
  }

  const bracket = state.bracket;
  const myName = state.myTeam.name;
  const currentRound = bracket.rounds[bracket.rounds.length - 1];
  const allDone = currentRound.every(s => s.done);
  const totalRounds = bracket.rounds.length;

  // ── Helper: render one matchup card ──────────────────────────────
  function seriesCard(s, slim){
    if(!s) return `<div style="min-height:${slim?54:66}px;"></div>`;
    const myIn = s.home===myName || s.away===myName;
    const hWin = s.done && s.winner===s.home;
    const aWin = s.done && s.winner===s.away;
    const accent = myIn ? 'rgba(41,128,185,0.55)' : 'rgba(100,160,220,0.18)';
    const shortName = n => n.split(' ').pop(); // last word (city abbreviations are long)
    const teamRow = (name, wins, isWinner, isLoser) => {
      const color = isWinner ? '#2ecc71' : isLoser ? 'rgba(255,255,255,0.22)' : 'var(--text)';
      const strike = isLoser ? 'text-decoration:line-through;' : '';
      const bold = isWinner ? 'font-weight:800;' : 'font-weight:500;';
      const star = name===myName ? ' <span style="color:var(--accent);font-size:10px;">★</span>' : '';
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px;">
        <span style="font-size:11px;${bold}${strike}color:${color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80px;">${shortName(name)}${star}</span>
        <span style="font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:800;color:${isWinner?'#2ecc71':isLoser?'rgba(255,255,255,0.22)':'var(--text2)'};">${wins}</span>
      </div>`;
    };
    return `<div style="background:var(--rink2);border:1px solid ${accent};border-radius:6px;overflow:hidden;margin:3px 0;${myIn?'box-shadow:0 0 0 1px rgba(41,128,185,0.2);':''}">
      ${teamRow(s.home, s.homeW, hWin, aWin)}
      <div style="height:1px;background:rgba(100,160,220,0.1);"></div>
      ${teamRow(s.away, s.awayW, aWin, hWin)}
    </div>`;
  }

  // ── Helper: get a series for a given round+conf+slot (or null) ──
  function getSeries(roundIdx, conf, slot){
    const r = bracket.rounds[roundIdx];
    if(!r) return null;
    const confSeries = r.filter(s => s.conf===conf);
    return confSeries[slot] || null;
  }

  // ── Helper: blank placeholder card ───────────────────────────────
  function blankCard(){
    return `<div style="background:rgba(255,255,255,0.02);border:1px dashed rgba(100,160,220,0.12);border-radius:6px;min-height:54px;margin:3px 0;"></div>`;
  }

  // ── Controls bar ─────────────────────────────────────────────────
  let ctrlHtml = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:18px;flex-wrap:wrap;">`;
  if(bracket.champion){
    ctrlHtml += `<button class="btn btn-gold" onclick="startOffseason()">Begin Offseason →</button>`;
  } else {
    ctrlHtml += `<button class="btn btn-gold" onclick="simAllSeries()">▶ Sim Round</button>`;
    if(allDone) ctrlHtml += `<button class="btn btn-red" onclick="advancePlayoffs()">Next Round →</button>`;
  }
  ctrlHtml += `</div>`;

  // ── Champion banner ───────────────────────────────────────────────
  let champHtml = '';
  if(bracket.champion){
    champHtml = `<div style="text-align:center;padding:16px 12px 20px;background:linear-gradient(135deg,rgba(243,156,18,0.08),rgba(241,196,15,0.04));border:1px solid rgba(243,156,18,0.3);border-radius:10px;margin-bottom:20px;">
      <div style="font-size:36px;margin-bottom:4px;">🏆</div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:800;color:var(--gold);">${bracket.champion}</div>
      <div style="font-size:12px;color:var(--text2);letter-spacing:1px;text-transform:uppercase;margin-top:4px;">Stanley Cup Champions</div>
    </div>`;
  }

  // ── Round name labels ─────────────────────────────────────────────
  const ROUND_LABELS = ['First Round','Second Round','Conf. Finals','Stanley Cup Final'];

  // ── Build the visual bracket ──────────────────────────────────────
  // Layout: [R1 East] [R2 East] [CF East] | [CUP] | [CF West] [R2 West] [R1 West]
  // We always render 4 columns per side regardless of rounds played so the structure is stable.

  const confs = ['Eastern','Western'];

  // Gather series by round+conf
  function confRound(roundIdx, conf){
    const r = bracket.rounds[roundIdx];
    if(!r) return [];
    return r.filter(s => s.conf===conf || s.conf==='Final');
  }

  // Column widths
  const colW = 118;
  const cupColW = 130;
  const gapW = 6;

  // For each conference, build 3 columns: R1(4 series), R2(2), CF(1)
  // Centre column: Cup Final (1 series)
  // Total columns: 3 + 1 + 3 = 7, but we mirror East on left, West on right

  function confColumns(conf, side){
    // side = 'left' (Eastern) or 'right' (Western)
    // Returns array of column HTML strings, outer→inner order for left, inner→outer for right
    const cols = [];
    for(let ri = 0; ri < 3; ri++){
      const r = bracket.rounds[ri];
      const label = ROUND_LABELS[ri];
      const seriesInConf = r ? r.filter(s=>s.conf===conf) : [];
      const maxSlots = ri===0 ? 4 : ri===1 ? 2 : 1;
      let colHtml = `<div style="width:${colW}px;flex-shrink:0;">`;
      // label
      colHtml += `<div style="font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.8px;text-align:center;margin-bottom:8px;white-space:nowrap;">${ri===0?label:''}</div>`;
      // series slots — vertically spaced to align with connectors
      const slotH = ri===0 ? 1 : ri===1 ? 2 : 4; // how many R1-slots each series spans
      for(let slot=0; slot<maxSlots; slot++){
        const s = seriesInConf[slot] || null;
        colHtml += `<div style="display:flex;flex-direction:column;justify-content:center;min-height:${slotH*72}px;">`;
        colHtml += s ? seriesCard(s) : (ri < totalRounds ? blankCard() : `<div style="min-height:54px;"></div>`);
        colHtml += `</div>`;
      }
      colHtml += `</div>`;
      cols.push(colHtml);
    }
    return side==='left' ? cols : [...cols].reverse();
  }

  // Cup Final column
  const cupSeries = bracket.rounds.length >= 4 ? bracket.rounds[3][0] : null;
  const cupColHtml = `<div style="width:${cupColW}px;flex-shrink:0;display:flex;flex-direction:column;">
    <div style="font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:0.8px;text-align:center;margin-bottom:8px;">${ROUND_LABELS[3]}</div>
    <div style="flex:1;display:flex;align-items:center;justify-content:center;">
      ${cupSeries ? seriesCard(cupSeries) : (bracket.rounds.length >= 3 && bracket.rounds[2].every(s=>s.done) ? blankCard() : `<div style="min-height:54px;"></div>`)}
    </div>
  </div>`;

  const eastCols = confColumns('Eastern','left');
  const westCols = confColumns('Western','right');

  // Round header row (above bracket)
  const headerHtml = `<div style="display:flex;gap:${gapW}px;align-items:flex-end;margin-bottom:2px;">
    ${eastCols.map((_,i)=>`<div style="width:${colW}px;flex-shrink:0;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;color:${i===2?'#5dade2':'var(--text2)'};text-transform:uppercase;letter-spacing:0.8px;text-align:center;">${ROUND_LABELS[i]}</div>`).join('')}
    <div style="width:${cupColW}px;flex-shrink:0;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:0.8px;text-align:center;">${ROUND_LABELS[3]}</div>
    ${westCols.map((_,i)=>`<div style="width:${colW}px;flex-shrink:0;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;color:${i===0?'#5dade2':'var(--text2)'};text-transform:uppercase;letter-spacing:0.8px;text-align:center;">${ROUND_LABELS[2-i]}</div>`).join('')}
  </div>`;

  // Conf labels
  const confLabelHtml = `<div style="display:flex;gap:${gapW}px;margin-bottom:10px;">
    <div style="width:${colW*3+gapW*2}px;text-align:center;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:800;color:var(--ice);text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid rgba(41,128,185,0.35);padding-bottom:6px;">Eastern Conference</div>
    <div style="width:${cupColW}px;"></div>
    <div style="width:${colW*3+gapW*2}px;text-align:center;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:800;color:var(--ice);text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid rgba(192,57,43,0.35);padding-bottom:6px;">Western Conference</div>
  </div>`;

  const bracketHtml = `<div style="overflow-x:auto;padding-bottom:8px;">
    <div style="min-width:${colW*6+cupColW+gapW*6}px;">
      ${confLabelHtml}
      ${headerHtml}
      <div style="display:flex;gap:${gapW}px;align-items:stretch;">
        ${eastCols.join('')}
        ${cupColHtml}
        ${westCols.join('')}
      </div>
    </div>
  </div>`;

  el.innerHTML = champHtml + ctrlHtml + bracketHtml;
}

// ---- offseason ----
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
              const gainChance = inAffiliate
                ? (devRate === 'fast' ? 0.20 : devRate === 'slow' ? 0.08 : 0.13)
                : (devRate === 'fast' ? 0.35 : devRate === 'slow' ? 0.15 : 0.25);
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
      const injRoll = Math.random();
      if(injRoll < injuryChance(p)){
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
  document.querySelectorAll('.nav-sub-btn.offseason-only').forEach(b=>b.classList.add('visible'));
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
  let html = `<div class="offseason-banner"><h2>Re-Sign Your Players</h2><p>Everyone whose NHL contract just expired (including ELCs ending this year) appears below. Final-year players on your roster are listed so you can extend before next season.</p></div>`;

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
    <p style="font-size:12px;color:var(--text2);margin-bottom:10px;">These players have one year remaining on their NHL deal. Use Extend to negotiate now, or they will roll to this list next offseason when the contract expires.</p>
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

  let html = `<div class="offseason-banner"><h2>NHL Entry Draft</h2><p>Round ${round}, Pick ${pickNum} of 32 · ${isMyPick?'<strong style="color:var(--gold)">YOUR PICK</strong>':'Simming other picks...'}</p></div>`;

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
  allTeams().forEach(t => archiveTeamSeasonStats(t, archiveSeason));
  archiveTeamSeasonStats(state.ahl, archiveSeason);
  archiveTeamSeasonStats(state.echl, archiveSeason);
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
// ---- lines ----
function getPlayerById(id){
  if(!id) return null;
  return state.myTeam.roster.find(p=>p.id===id) || null;
}

function lineOVR(playerIds){
  const players = playerIds.map(id=>getPlayerById(id)).filter(Boolean);
  if(!players.length) return 0;
  return Math.round(players.reduce((s,p)=>s+p.ovr,0)/players.length);
}

function linesEffectiveness(){
  // Calculate overall lines effectiveness for game sim
  // Weighted: Line 1 = 35%, Line 2 = 25%, Line 3 = 20%, Line 4 = 10%, Defense = 8%, Goalie = 2%
  const lines = state.lines;
  let score = 0, weight = 0;
  const weights = [0.35, 0.25, 0.20, 0.10];
  lines.forwards.forEach((line,i)=>{
    const ovr = lineOVR(line.players);
    if(ovr){ score += ovr * weights[i]; weight += weights[i]; }
  });
  lines.defense.forEach(pair=>{
    const ovr = lineOVR(pair.players);
    if(ovr){ score += ovr * 0.025; weight += 0.025; }
  });
  const goalie = getPlayerById(lines.goalies.starter);
  if(goalie){ score += goalie.ovr * 0.02; weight += 0.02; }
  return weight > 0 ? score / weight : teamOVR(state.myTeam.roster);
}

function autoSetLines(){
  // Only fill EMPTY slots or slots whose player is no longer on the roster.
  // Never displace a player who is already correctly assigned.
  const roster = state.myTeam.roster;
  const rosterIds = new Set(roster.map(p=>p.id));
  const byPos = {};
  ['C','LW','RW','LD','RD','G'].forEach(pos=>{
    byPos[pos] = roster.filter(x=>x.pos===pos).sort((a,b)=>b.ovr-a.ovr);
  });

  // First pass: clear any slots whose player left the roster
  const lines = state.lines;
  lines.forwards.forEach(line=>{
    line.players = line.players.map(id => (id && rosterIds.has(id)) ? id : null);
  });
  lines.defense.forEach(pair=>{
    pair.players = pair.players.map(id => (id && rosterIds.has(id)) ? id : null);
  });
  if(lines.goalies.starter && !rosterIds.has(lines.goalies.starter)) lines.goalies.starter = null;
  if(lines.goalies.backup  && !rosterIds.has(lines.goalies.backup))  lines.goalies.backup  = null;

  // Second pass: fill only null slots with best available unassigned player
  lines.forwards.forEach(line=>{
    line.slots.forEach((pos,i)=>{
      if(line.players[i]) return; // already filled — don't touch
      const avail = byPos[pos] && byPos[pos].find(p=>!isPlayerAssigned(p.id));
      if(avail) line.players[i] = avail.id;
    });
  });
  lines.defense.forEach(pair=>{
    pair.slots.forEach((pos,i)=>{
      if(pair.players[i]) return;
      const avail = byPos[pos] && byPos[pos].find(p=>!isPlayerAssigned(p.id));
      if(avail) pair.players[i] = avail.id;
    });
  });
  const goalies = byPos['G'] || [];
  if(!lines.goalies.starter){
    const g = goalies.find(p=>!isPlayerAssigned(p.id));
    if(g) lines.goalies.starter = g.id;
  }
  if(!lines.goalies.backup){
    const g = goalies.find(p=>!isPlayerAssigned(p.id));
    if(g) lines.goalies.backup = g.id;
  }

  renderLines();
}

function isPlayerAssigned(id){
  const l = state.lines;
  for(const line of l.forwards){ if(line.players.includes(id)) return true; }
  for(const pair of l.defense){ if(pair.players.includes(id)) return true; }
  if(l.goalies.starter===id || l.goalies.backup===id) return true;
  return false;
}

function openSlotPicker(type, lineIdx, slotIdx){
  // type: 'forward','defense','goalie-starter','goalie-backup'
  state._slotPicker = { type, lineIdx, slotIdx };
  const pos = type==='forward' ? state.lines.forwards[lineIdx].slots[slotIdx]
            : type==='defense' ? state.lines.defense[lineIdx].slots[slotIdx]
            : 'G';
  // Filter roster by position
  const candidates = state.myTeam.roster.filter(p=>p.pos===pos).sort((a,b)=>b.ovr-a.ovr);
  const el = document.getElementById('lines-body');
  let html = `<div style="margin-bottom:16px;">
    <button class="btn" onclick="renderLines()" style="margin-bottom:12px;">← Back to Lines</button>
    <div style="font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:800;margin-bottom:12px;">Select ${pos} for ${type==='forward'?state.lines.forwards[lineIdx].name:type==='defense'?state.lines.defense[lineIdx].name:'Goalie'}</div>
    <table width="100%" style="border-collapse:collapse;font-size:13px;">
      <thead><tr>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Player</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">OVR</th>
        <th style="padding:6px 8px;border-bottom:1px solid var(--border);"></th>
      </tr></thead><tbody>`;
  candidates.forEach(p=>{
    const assigned = isPlayerAssigned(p.id);
    html += `<tr>
      <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);font-weight:500;">${p.name}${assigned?' <span style="font-size:10px;color:var(--text2);">(assigned)</span>':''}</td>
      <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">${ovrCell(p.ovr)}</td>
      <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);"><button class="btn btn-sm btn-gold" onclick="assignToSlot('${p.id}')">Select</button></td>
    </tr>`;
  });
  if(!candidates.length) html += `<tr><td colspan="3" style="padding:12px;color:var(--text2);font-style:italic;">No ${pos} players on roster.</td></tr>`;
  html += `</tbody></table></div>`;
  el.innerHTML = html;
}

function assignToSlot(playerId){
  const { type, lineIdx, slotIdx } = state._slotPicker;
  if(type==='forward') state.lines.forwards[lineIdx].players[slotIdx] = playerId;
  else if(type==='defense') state.lines.defense[lineIdx].players[slotIdx] = playerId;
  else if(type==='goalie-starter') state.lines.goalies.starter = playerId;
  else if(type==='goalie-backup') state.lines.goalies.backup = playerId;
  renderLines();
}

function removeFromSlot(type, lineIdx, slotIdx){
  if(type==='forward') state.lines.forwards[lineIdx].players[slotIdx] = null;
  else if(type==='defense') state.lines.defense[lineIdx].players[slotIdx] = null;
  else if(type==='goalie-starter') state.lines.goalies.starter = null;
  else if(type==='goalie-backup') state.lines.goalies.backup = null;
  renderLines();
}

function renderLineCard(line, type, lineIdx){
  const ovr = lineOVR(line.players);
  const maxOVR = 99, minOVR = 70;
  const pct = ovr ? ((ovr-minOVR)/(maxOVR-minOVR)*100).toFixed(0) : 0;
  const color = ovrColor(ovr);
  let html = `<div class="line-card">
    <div class="line-card-title">${line.name}<span class="line-card-ovr" style="color:${color}">${ovr||'—'}</span></div>`;
  line.slots.forEach((pos,i)=>{
    const p = getPlayerById(line.players[i]);
    html += `<div class="line-slot">
      <div class="line-slot-pos">${pos}</div>
      ${p ? `<div class="line-slot-name">${p.name}</div>
             <div class="line-slot-ovr" style="color:${ovrColor(p.ovr)}">${p.ovr}</div>
             <button class="btn btn-xs" onclick="removeFromSlot('${type}',${lineIdx},${i})" style="color:var(--red2);border-color:rgba(192,57,43,0.3);">✕</button>`
           : `<div class="line-slot-empty" style="flex:1;">Empty — <span style="cursor:pointer;color:var(--accent);" onclick="openSlotPicker('${type}',${lineIdx},${i})">assign player</span></div>`}
      ${p ? `<button class="btn btn-xs" onclick="openSlotPicker('${type}',${lineIdx},${i})" style="margin-left:2px;">↕</button>` : ''}
    </div>`;
  });
  if(ovr){
    html += `<div class="line-effectiveness"><div class="line-effectiveness-fill" style="width:${pct}%;background:${color};"></div></div>`;
  }
  html += `</div>`;
  return html;
}

function renderLines(){ if(!gameStarted) return;
  const el = document.getElementById('lines-body');
  if(!el) return;
  const eff = linesEffectiveness();
  const teamOvr = teamOVR(state.myTeam.roster);
  const bonus = eff > teamOvr ? `+${(eff-teamOvr).toFixed(1)}` : (eff-teamOvr).toFixed(1);
  const bonusColor = eff >= teamOvr ? '#2ecc71' : 'var(--red2)';

  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
    <div>
      <div style="font-size:13px;color:var(--text2);">Lines effectiveness: <strong style="color:${bonusColor}">${eff.toFixed(1)} OVR</strong> <span style="font-size:12px;color:${bonusColor};">(${bonus} vs roster avg)</span></div>
      <div style="font-size:12px;color:var(--text2);margin-top:2px;">Better line deployment = better game performance</div>
    </div>
    <button class="btn btn-gold" onclick="autoSetLines()">⚡ Auto-Set Lines</button>
  </div>`;

  // Forward lines
  html += `<div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Forward Lines</div>`;
  html += `<div class="lines-grid">`;
  state.lines.forwards.forEach((line,i)=>{ html += renderLineCard(line,'forward',i); });
  html += `</div>`;

  // Defense pairs
  html += `<div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin:16px 0 10px;">Defensive Pairs</div>`;
  html += `<div class="lines-grid">`;
  state.lines.defense.forEach((pair,i)=>{ html += renderLineCard(pair,'defense',i); });
  html += `</div>`;

  // Goalies
  html += `<div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin:16px 0 10px;">Goalies</div>`;
  html += `<div class="lines-grid">`;
  ['starter','backup'].forEach(role=>{
    const p = getPlayerById(state.lines.goalies[role]);
    html += `<div class="line-card">
      <div class="line-card-title">${role==='starter'?'Starter':'Backup'}<span class="line-card-ovr" style="color:${p?(ovrColor(p.ovr)):'var(--text2)'}">${p?p.ovr:'—'}</span></div>
      <div class="line-slot">
        <div class="line-slot-pos">G</div>
        ${p ? `<div class="line-slot-name">${p.name}</div>
               <button class="btn btn-xs" onclick="removeFromSlot('goalie-${role}',0,0)" style="color:var(--red2);border-color:rgba(192,57,43,0.3);">✕</button>
               <button class="btn btn-xs" onclick="openSlotPicker('goalie-${role}',0,0)" style="margin-left:2px;">↕</button>`
             : `<div class="line-slot-empty" style="flex:1;">Empty — <span style="cursor:pointer;color:var(--accent);" onclick="openSlotPicker('goalie-${role}',0,0)">assign goalie</span></div>`}
      </div>
    </div>`;
  });
  html += `</div>`;
  el.innerHTML = html;
}

// ---- affiliates ----
// ---- Demotion Priority Logic ----
// Returns a sorted list of NHL roster players from most to least demotable.
// Lower OVR, younger prospects, and surplus positions are demoted first.
function getDemotionCandidates(roster){
  const posCount = {};
  const posNeeds = { C:4, LW:4, RW:4, LD:3, RD:3, G:3 }; // ideal NHL roster slots

  // Count how many of each position we have
  roster.forEach(p=>{ posCount[p.pos] = (posCount[p.pos]||0) + 1; });

  return [...roster].sort((a, b)=>{
    // Priority 1: Players in surplus positions get demoted first
    const aExcess = (posCount[a.pos]||0) - (posNeeds[a.pos]||2);
    const bExcess = (posCount[b.pos]||0) - (posNeeds[b.pos]||2);
    if(bExcess !== aExcess) return bExcess - aExcess; // more surplus = demote first

    // Priority 2: Lower OVR gets demoted first
    if(a.ovr !== b.ovr) return a.ovr - b.ovr;

    // Priority 3: Younger prospects on entry-level deals are more demotable
    if(a.isDraftee !== b.isDraftee) return a.isDraftee ? -1 : 1;

    return 0;
  });
}

// Warn if trying to demote a core/elite player
function isDemotionWarrant(p){
  if(p.ovr >= 88) return `⚠️ ${p.name} is an elite player (${p.ovr} OVR) — are you sure?`;

  return null;
}

/** NHL-only: minors used to tick years without expiring, producing -2yr etc. Call when promoting or cleaning saves. */
function repairPromotedContract(p){
  if(!p) return;
  if(typeof p.years === 'number' && p.years >= 1) return;
  if(p.isELC && isELCEligible(p)){
    p.years = ELC.maxYears;
    p.salary = ELC.maxSalary;
    p.capPct = salaryToCapPct(p.salary);
  } else {
    p.isELC = false;
    p.years = Math.max(1, contractYears(p.ovr, p.age));
    p.salary = Math.max(league.minSalary, salFromOVR(p.ovr));
    p.capPct = salaryToCapPct(p.salary);
  }
  delete p.elcJustExpired;
}

function sendToAHL(playerId){
  const idx = state.myTeam.roster.findIndex(p=>p.id===playerId);
  if(idx===-1) return;
  const p = state.myTeam.roster[idx];

  // Block if NMC/M-NMC prevents minors assignment
  const minorsCheck = canSendToMinors(p);
  if(!minorsCheck.allowed){ alert(minorsCheck.reason); return; }

  // Enforce AHL roster cap
  const { AHL_MAX, TWO_WAY_MAX } = AFFILIATE_TIERS;
  if(state.ahl.roster.length >= AHL_MAX){
    alert(`AHL roster is full (max ${AHL_MAX} players). Call someone up or release a player first.`);
    return;
  }
  // Enforce two-way contract limit (ELC players don't count against two-way limit)
  const twoWayCount = [...state.ahl.roster, ...state.echl.roster].filter(p => !p.isELC).length;
  if(twoWayCount >= TWO_WAY_MAX){
    alert(`Two-way contract limit reached (max ${TWO_WAY_MAX} players across AHL & ECHL). Call someone up first.`);
    return;
  }

  const warning = isDemotionWarrant(p);
  if(warning) console.warn(warning);
  if(warning) console.warn(warning);

  // Log demotion reason
  const posCount = {};
  state.myTeam.roster.forEach(x=>{ posCount[x.pos]=(posCount[x.pos]||0)+1; });
  const posNeeds = { C:4, LW:4, RW:4, LD:3, RD:3, G:3 };
  const surplus = (posCount[p.pos]||0) - (posNeeds[p.pos]||2);
  const reason = surplus > 0 ? `surplus ${p.pos} (${posCount[p.pos]} on roster)` : `OVR ${p.ovr}`;
  console.log(`[Send Down] ${p.name} (OVR ${p.ovr}) → AHL | Reason: ${reason}${warning?' | '+warning:''}`);

  state.myTeam.roster.splice(idx, 1);
  p._affiliate = 'ahl';
  // Always preserve the NHL salary so callup can restore it
  if(!p.nhlSalary) p.nhlSalary = p.salary;
  // Two-way: swap active salary to minor rate for display purposes
  // One-way & ELC: p.salary stays as-is (cap still charged at NHL rate via capUsed())
  if(p.isTwoWay && p.minorSalary != null){
    p.salary = p.minorSalary;
    p.capPct = salaryToCapPct(p.minorSalary);
  }
  state.ahl.roster.push(p);
  autoSetLines();
  state.log.push(`⬇️ ${p.name} (${p.ovr} OVR) sent to AHL`);
  renderAll();
  renderAffiliates();
}

function sendToECHL(playerId){
  const idx = state.myTeam.roster.findIndex(p=>p.id===playerId);
  if(idx!==-1){
    const p = state.myTeam.roster[idx];
    const warning = isDemotionWarrant(p);
    if(warning) console.warn(warning);

    // Enforce ECHL roster cap
    const { ECHL_MAX, TWO_WAY_MAX } = AFFILIATE_TIERS;
    if(state.echl.roster.length >= ECHL_MAX){
      alert(`ECHL roster is full (max ${ECHL_MAX} players). Call someone up or release a player first.`);
      return;
    }
    const twoWayCount = [...state.ahl.roster, ...state.echl.roster].filter(p => !p.isELC).length;
    if(twoWayCount >= TWO_WAY_MAX){
      alert(`Two-way contract limit reached (max ${TWO_WAY_MAX} players across AHL & ECHL). Call someone up first.`);
      return;
    }
    console.log(`[Send Down] ${p.name} (OVR ${p.ovr}) → ECHL | From NHL roster`);
    state.myTeam.roster.splice(idx, 1);
    p._affiliate = 'echl';
    // Always preserve the NHL salary so callup can restore it
    if(!p.nhlSalary) p.nhlSalary = p.salary;
    // Two-way: swap active salary to minor rate for display
    // One-way & ELC: cap still charged at NHL rate via capUsed()
    if(p.isTwoWay && p.minorSalary != null){
      p.salary = p.minorSalary;
      p.capPct = salaryToCapPct(p.minorSalary);
    }
    state.echl.roster.push(p);
    state.log.push(`⬇️ ${p.name} (${p.ovr} OVR) sent to ECHL`);
  } else {
    // Demoting from AHL to ECHL
    const idx2 = state.ahl.roster.findIndex(p=>p.id===playerId);
    if(idx2!==-1){
      const p = state.ahl.roster[idx2];
      console.log(`[Send Down] ${p.name} (OVR ${p.ovr}) → ECHL | From AHL roster`);
      state.ahl.roster.splice(idx2, 1);
      p._affiliate = 'echl';
      state.echl.roster.push(p);
      state.log.push(`⬇️ ${p.name} (${p.ovr} OVR) sent to ECHL`);
    }
  }
  renderAll();
  renderAffiliates();
}

// Auto-trim: send excess players down using OVR tiers when roster exceeds 23
function autoTrimRoster(){
  const MAX_NHL = 23;
  const roster = state.myTeam.roster;
  if(roster.length <= MAX_NHL) return;
  const { NHL_MIN, AHL_MIN } = AFFILIATE_TIERS;
  const candidates = getDemotionCandidates(roster);
  const toSend = candidates.slice(0, roster.length - MAX_NHL);
  toSend.forEach(p=>{
    if(p.ovr < AHL_MIN){
      console.log(`[Auto Trim] ${p.name} (OVR ${p.ovr}, ${p.pos}) sent to ECHL — below AHL threshold`);
      sendToECHL(p.id);
    } else {
      console.log(`[Auto Trim] ${p.name} (OVR ${p.ovr}, ${p.pos}) sent to AHL — roster over limit`);
      sendToAHL(p.id);
    }
  });
}

function callUp(playerId, fromLeague){
  const src = fromLeague==='ahl' ? state.ahl : state.echl;
  const idx = src.roster.findIndex(p=>p.id===playerId);
  if(idx===-1) return;
  const p = src.roster.splice(idx,1)[0];
  p._affiliate=null;
  // Restore NHL salary for two-way players
  if(p.isTwoWay && p.nhlSalary != null){
    p.salary = p.nhlSalary;
    p.capPct = salaryToCapPct(p.nhlSalary);
  }
  repairPromotedContract(p);
  state.myTeam.roster.push(p);
  autoSetLines();
  state.log.push(`⬆️ ${p.name} called up to ${state.myTeam.name}`);
  renderAll();
  renderAffiliates();
}

function callUpFromECHLToAHL(playerId){
  const idx = state.echl.roster.findIndex(p=>p.id===playerId);
  if(idx===-1) return;
  const p = state.echl.roster.splice(idx,1)[0];
  p._affiliate='ahl';
  repairPromotedContract(p);
  state.ahl.roster.push(p);
  state.log.push(`⬆️ ${p.name} promoted to AHL (${state.ahl.name})`);
  renderAll();
  renderAffiliates();
}

function simAffiliateGame(affiliate){
  const ovr = affiliate.roster.length ? Math.round(affiliate.roster.reduce((s,p)=>s+p.ovr,0)/affiliate.roster.length) : 78;
  const oppOVR = ovr + rnd(-6,6);
  let mg = rnd(0,6), og = rnd(0,6);
  if(ovr > oppOVR+4) mg = Math.max(mg,og);
  else if(oppOVR > ovr+4) og = Math.max(mg,og);
  if(mg>og){ affiliate.w++; return 'W'; }
  else if(mg<og){ affiliate.l++; return 'L'; }
  else { affiliate.otl++; return 'OTL'; }
}

function developAffiliatePlayers(){
  // Intentionally empty — affiliate development is handled once per offseason
  // in startOffseason() via the main progression loop, not weekly.
}

function renderAffiliates(){ if(!gameStarted) return;
  const el = document.getElementById('affiliates-body');
  if(!el) return;

  function affiliateTable(aff, league, fromKey){
    if(!aff.roster.length) return `<div style="color:var(--text2);font-size:13px;font-style:italic;">No players assigned. Send prospects down from your roster.</div>`;
    return `<table width="100%" style="border-collapse:collapse;font-size:13px;margin-top:8px;">
      <thead><tr>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Player</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Pos</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Age</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">OVR</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">${league==='ahl'?'Potential':''}</th>
        <th style="padding:6px 8px;border-bottom:1px solid var(--border);"></th>
      </tr></thead><tbody>
      ${aff.roster.map(p=>`<tr>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);font-weight:500;">${p.name}${p.isTwoWay?`<span title="Two-Way Contract" style="font-size:10px;font-family:'Barlow Condensed',sans-serif;font-weight:700;padding:1px 5px;border-radius:3px;background:rgba(41,128,185,0.18);color:#5dade2;border:1px solid rgba(41,128,185,0.4);margin-left:5px;">2-WAY</span>`:''}</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);"><span class="pos-badge">${p.pos}</span></td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">${p.age}</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">${ovrCell(p.ovr)}</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">${p.isTwoWay && p.minorSalary ? `<span style="font-size:11px;color:#5dade2;">$${p.minorSalary.toFixed(2)}M</span>` : (p.potential?`<span class="prospect-potential pot-${p.potential}">${p.potential} (${p.potCeil})</span>`:'')}</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">
          <button class="btn btn-xs btn-gold" onclick="callUp('${p.id}','${fromKey}')">↑ NHL</button>
          ${fromKey==='echl'?`<button class="btn btn-xs" style="margin-left:4px;" onclick="callUpFromECHLToAHL('${p.id}')">↑ AHL</button>`:''}
          ${fromKey==='ahl'?`<button class="btn btn-xs" style="margin-left:4px;border-color:rgba(192,57,43,0.4);color:var(--red2);" onclick="sendToECHL('${p.id}')">↓ ECHL</button>`:''}
        </td>
      </tr>`).join('')}
      </tbody></table>`;
  }

  let html = '';

  // AHL
  html += `<div class="affiliate-section">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
      <div>
        <div class="affiliate-header" style="color:#5dade2;">AHL — ${state.ahl.name}</div>
        <div class="affiliate-sub">Primary development affiliate · ${state.ahl.roster.length}/${AFFILIATE_TIERS.AHL_MAX} players · Two-way: ${[...state.ahl.roster, ...state.echl.roster].filter(p => !p.isELC).length}/${AFFILIATE_TIERS.TWO_WAY_MAX}</div>
      </div>
      <div style="text-align:right;">
        <div class="affiliate-record">${state.ahl.w}-${state.ahl.l}-${state.ahl.otl}</div>
        <div style="font-size:11px;color:var(--text2);">${state.ahl.w*2+state.ahl.otl} pts</div>
      </div>
    </div>
    ${affiliateTable(state.ahl,'ahl','ahl')}
  </div>`;

  // ECHL
  html += `<div class="affiliate-section">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
      <div>
        <div class="affiliate-header" style="color:var(--gold);">ECHL — ${state.echl.name}</div>
        <div class="affiliate-sub">Secondary development affiliate · ${state.echl.roster.length}/${AFFILIATE_TIERS.ECHL_MAX} players</div>
      </div>
      <div style="text-align:right;">
        <div class="affiliate-record">${state.echl.w}-${state.echl.l}-${state.echl.otl}</div>
        <div style="font-size:11px;color:var(--text2);">${state.echl.w*2+state.echl.otl} pts</div>
      </div>
    </div>
    ${affiliateTable(state.echl,'echl','echl')}
  </div>`;

  // NHL roster send-down section
  html += `<div class="affiliate-section">
    <div class="affiliate-header" style="font-size:15px;margin-bottom:8px;">Send Down from NHL Roster</div>
    <div style="font-size:13px;color:var(--text2);margin-bottom:12px;">Players on your NHL roster you can assign to affiliates.</div>
    <table width="100%" style="border-collapse:collapse;font-size:13px;">
      <thead><tr>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Player</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Pos</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Age</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">OVR</th>
        <th style="padding:6px 8px;border-bottom:1px solid var(--border);"></th>
      </tr></thead><tbody>
      ${getDemotionCandidates(state.myTeam.roster).map(p=>{
        const exempt = isWaiverExempt(p);
        const ahlLabel = exempt ? '&#8595; AHL' : '&#128203;&rarr; AHL';
        const echlLabel = exempt ? '&#8595; ECHL' : '&#128203;&rarr; ECHL';
        const ahlTitle = exempt ? 'Waiver-exempt: direct AHL' : 'Waiver required';
        const echlTitle = exempt ? 'Waiver-exempt: direct ECHL' : 'Waiver required';
        return `<tr>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);font-weight:500;">${p.name}</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);"><span class="pos-badge">${p.pos}</span></td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">${p.age}</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">${ovrCell(p.ovr)}</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">
          <button class="btn btn-xs" onclick="placeOnWaivers('${p.id}','ahl')" title="${ahlTitle}">${ahlLabel}</button>
          <button class="btn btn-xs" style="margin-left:4px;" onclick="placeOnWaivers('${p.id}','echl')" title="${echlTitle}">${echlLabel}</button>
        </td>
      </tr>`;}).join('')}
      </tbody></table>
  </div>`;

  el.innerHTML = html;
}

// openPlayerPage defined below (single authoritative definition)

function renderPlayerPage(){ if(!gameStarted) return;
  const el = document.getElementById('player-page-content');
  const found = findPlayerById(playerPageId);
  if(!found){ el.innerHTML='<p style="color:var(--text2)">Player not found.</p>'; return; }
  const p = found.player;
  const s = getStatLine(p);
  const isGoalie = p.pos==='G';
  const isFA = found.source === 'fa';
  const isOtherTeam = found.source === 'other';

  let html = `
    <!-- Header -->
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;flex-wrap:wrap;">
      <div style="width:72px;height:72px;background:var(--red);border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:26px;flex-shrink:0;">
        ${p.pos}
      </div>
      <div style="flex:1;">
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:34px;font-weight:800;line-height:1;">${p.name}${p.archetype ? `<span style="font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:700;color:var(--accent);background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:4px;padding:2px 8px;margin-left:10px;vertical-align:middle;text-transform:uppercase;letter-spacing:1px;">${p.archetype}</span>` : ''}</div>
        <div style="font-size:13px;color:var(--text2);margin-top:3px;">${isOtherTeam ? `<span style="color:var(--accent);font-weight:600;">${found.teamName}</span> · ` : ''}${p.pos} · Age ${p.age} · ${p.years}yr left · $${p.salary.toFixed(2)}M (${salaryToCapPct(p.salary).toFixed(2)}% cap)</div>
        <div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          ${projBadge(p)}
          ${(()=>{ const rl=readinessLabel(p); return rl?`<span style="font-size:11px;color:${rl.color};background:rgba(255,255,255,0.05);padding:1px 6px;border-radius:3px;">${rl.text}</span>`:''; })()}
          ${p.devVariance?`<span style="font-size:11px;color:var(--text2);">${p.devVariance.label}</span>`:''}
        </div>

      </div>
      <div style="text-align:right;">
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:54px;font-weight:800;color:${ovrColor(p.ovr)};">${p.ovr}</div>
        <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:1px;">Overall</div>
      </div>
    </div>

    <!-- Tabs -->
    <div style="display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:16px;flex-wrap:wrap;">
      ${['overview','stats','playoffs','history','career','contract'].map(t=>`
        <button onclick="setPlayerTab('${t}')" style="font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding:8px 16px;border:none;border-bottom:3px solid ${playerPageTab===t?'var(--accent)':'transparent'};background:none;color:${playerPageTab===t?'var(--ice)':'var(--text2)'};cursor:pointer;">
          ${{overview:'Overview',stats:'This Season',playoffs:'Playoffs',history:'Career History',career:'Career Totals',contract:'Contract'}[t]}
        </button>`).join('')}
    </div>`;

  if(playerPageTab==='overview'){
    const fmt = k => k.replace(/([A-Z])/g,' $1').replace(/^./,s=>s.toUpperCase());
    // compact attr row: label | bar | value
    const attrRow = (label, v, isParent) => `
      <div style="display:flex;align-items:center;gap:5px;padding:${isParent?'4px 6px':'2px 6px 2px 12px'};${isParent?'background:rgba(255,255,255,0.04);border-bottom:1px solid var(--border);':'border-bottom:1px solid rgba(100,160,220,0.05);'}">
        <div style="font-size:${isParent?'11px':'10px'};font-weight:${isParent?'700':'400'};color:${isParent?'var(--text)':'var(--text2)'};flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${label}</div>
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:${isParent?'13px':'11px'};font-weight:800;color:${attrColor(v)};min-width:20px;text-align:right;">${v}</div>
      </div>`;

    // ── Info strip ──────────────────────────────────────────────────
    html += `
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
      <div class="stat-card" style="flex:1;min-width:80px;padding:8px 10px;"><div class="stat-card-label">OVR</div><div class="stat-card-val" style="color:${ovrColor(p.ovr)}">${p.ovr}</div></div>
      <div class="stat-card" style="flex:1;min-width:80px;padding:8px 10px;"><div class="stat-card-label">Age</div><div class="stat-card-val ${p.age>=35?'bad':p.age>=30?'warn':''}">${p.age}${p.age>=35?' 🔴':p.age>=30?' 🟡':''}</div></div>
      <div class="stat-card" style="flex:1;min-width:80px;padding:8px 10px;"><div class="stat-card-label">Salary</div><div class="stat-card-val" style="font-size:16px;">$${p.salary.toFixed(2)}M</div></div>
      <div class="stat-card" style="flex:1;min-width:80px;padding:8px 10px;"><div class="stat-card-label">Cap %</div><div class="stat-card-val" style="font-size:16px;">${salaryToCapPct(p.salary).toFixed(2)}%</div></div>
      <div class="stat-card" style="flex:1;min-width:80px;padding:8px 10px;"><div class="stat-card-label">Yrs Left</div><div class="stat-card-val">${p.years}</div></div>
      ${p.isELC?`<div class="stat-card" style="flex:1;min-width:80px;padding:8px 10px;"><div class="stat-card-label">Contract</div><div class="stat-card-val warn" style="font-size:14px;">ELC</div></div>`:''}
      ${p.inDecline||p.decliningFast?`<div class="stat-card" style="flex:1;min-width:80px;padding:8px 10px;"><div class="stat-card-label">Status</div><div class="stat-card-val bad" style="font-size:13px;">${p.decliningFast?'⬇⬇ Rapid':'⬇ Declining'}</div></div>`:''}
      ${p.trueGrade||p.potential?`<div class="stat-card" style="flex:1;min-width:80px;padding:8px 10px;"><div class="stat-card-label">${p.gradeRevealed?'Grade':'Scouted'}</div><div class="stat-card-val" style="font-size:16px;color:var(--gold);">${p.gradeRevealed?p.trueGrade:scoutingRange(p,state.myTeam)}</div></div>`:''}
    </div>

    <!-- ── 4-column attribute grid ── -->
    ${p.attrs ? (()=>{
      if(p.pos==='G'){
        const goalieGroups = [
          { label:'Athleticism', keys:['reflexes','agility','recovery','endurance'] },
          { label:'Technical',   keys:['positioning','angles','reboundControl','gloveStick','puckTracking'] },
          { label:'Mental',      keys:['poise','anticipation','consistency'] },
          { label:'Physical',    keys:['strength','aggression','durability'] },
        ];
        return `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">
          ${goalieGroups.map(g=>`
            <div style="background:var(--rink2);border:1px solid var(--border);border-radius:7px;overflow:hidden;">
              <div style="padding:6px 8px;background:rgba(255,255,255,0.04);border-bottom:1px solid var(--border);font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:1px;">${g.label}</div>
              ${g.keys.map(k=>{
                const v = p.attrs?.[k] || 0;
                const meta = GOALIE_ATTR_SUBS[k];
                const label = meta ? meta.label : fmt(k);
                const subs = meta ? meta.subs.map(sub => attrRow(sub.label, p.attrs?.[sub.key] || v, false)).join('') : '';
                return attrRow(label, v, true) + subs;
              }).join('')}
            </div>`).join('')}
        </div>`;
      }
      const groups = [
        { label:'Skating',   keys:['speed','acceleration','agility','balance','endurance'] },
        { label:'Offensive', keys:['shootingAccuracy','shotPower','passing','puckHandling','offensiveIQ','vision'] },
        { label:'Defensive', keys:['defensiveIQ','positioning','stickChecking','shotBlocking','faceoffs','poise'] },
        { label:'Physical',  keys:['strength','checking','aggression','discipline'] },
      ];
      return `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">
        ${groups.map(g=>`
          <div style="background:var(--rink2);border:1px solid var(--border);border-radius:7px;overflow:hidden;">
            <div style="padding:6px 8px;background:rgba(255,255,255,0.04);border-bottom:1px solid var(--border);font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:1px;">${g.label}</div>
            ${g.keys.map(k=>{
              const v = p.attrs[k]||0;
              const meta = SKATER_ATTR_SUBS[k];
              const label = meta ? meta.label : fmt(k);
              const subs = meta ? meta.subs.map(sub => attrRow(sub.label, p.attrs[sub.key]||v, false)).join('') : '';
              return attrRow(label, v, true) + subs;
            }).join('')}
          </div>`).join('')}
      </div>`;
    })() : ''}
`;
  }

  if(playerPageTab==='stats'){
    if(isGoalie){
      const sv = calcSV(p);
      const gaa = calcGAA(p);
      html += `
      <div style="margin-bottom:16px;font-size:13px;color:var(--text2);">Season ${state.season} Statistics</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px;margin-bottom:20px;">
        <div class="stat-card"><div class="stat-card-label">GP</div><div class="stat-card-val">${s.gp||0}</div></div>
        <div class="stat-card"><div class="stat-card-label">W</div><div class="stat-card-val good">${s.w||0}</div></div>
        <div class="stat-card"><div class="stat-card-label">L</div><div class="stat-card-val bad">${s.l||0}</div></div>
        <div class="stat-card"><div class="stat-card-label">GA</div><div class="stat-card-val">${s.ga||0}</div></div>
        <div class="stat-card"><div class="stat-card-label">SV%</div><div class="stat-card-val" style="font-size:18px;">${(sv*100).toFixed(1)}%</div></div>
        <div class="stat-card"><div class="stat-card-label">GAA</div><div class="stat-card-val" style="font-size:18px;">${gaa}</div></div>
        <div class="stat-card"><div class="stat-card-label">Saves</div><div class="stat-card-val">${s.saves||0}</div></div>
        <div class="stat-card"><div class="stat-card-label">SA</div><div class="stat-card-val">${s.sa||0}</div></div>
      </div>
      <div style="background:var(--rink2);border:1px solid var(--border);border-radius:8px;overflow:hidden;">
        <table width="100%" style="border-collapse:collapse;font-size:13px;">
          <thead><tr style="border-bottom:1px solid var(--border);">
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:var(--text2);font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">Stat</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;color:var(--text2);font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">Total</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;color:var(--text2);font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">Per Game</th>
          </tr></thead>
          <tbody>
            <tr style="border-bottom:1px solid rgba(100,160,220,0.07);">
              <td style="padding:8px 12px;">Wins</td><td style="padding:8px 12px;text-align:right;font-weight:600;color:#2ecc71;">${s.w||0}</td>
              <td style="padding:8px 12px;text-align:right;color:var(--text2);">${s.gp?(s.w/s.gp).toFixed(2):'0.00'}</td>
            </tr>
            <tr style="border-bottom:1px solid rgba(100,160,220,0.07);">
              <td style="padding:8px 12px;">Losses</td><td style="padding:8px 12px;text-align:right;font-weight:600;color:var(--red2);">${s.l||0}</td>
              <td style="padding:8px 12px;text-align:right;color:var(--text2);">${s.gp?(s.l/s.gp).toFixed(2):'0.00'}</td>
            </tr>
            <tr style="border-bottom:1px solid rgba(100,160,220,0.07);">
              <td style="padding:8px 12px;">Goals Against</td><td style="padding:8px 12px;text-align:right;font-weight:600;">${s.ga||0}</td>
              <td style="padding:8px 12px;text-align:right;color:var(--text2);">${s.gp?(s.ga/s.gp).toFixed(2):'0.00'}</td>
            </tr>
            <tr style="border-bottom:1px solid rgba(100,160,220,0.07);">
              <td style="padding:8px 12px;">Saves</td><td style="padding:8px 12px;text-align:right;font-weight:600;">${s.saves||0}</td>
              <td style="padding:8px 12px;text-align:right;color:var(--text2);">${s.gp?(s.saves/s.gp).toFixed(2):'0.00'}</td>
            </tr>
            <tr style="border-bottom:1px solid rgba(100,160,220,0.07);">
              <td style="padding:8px 12px;">Shots Against</td><td style="padding:8px 12px;text-align:right;font-weight:600;">${s.sa||0}</td>
              <td style="padding:8px 12px;text-align:right;color:var(--text2);">${s.gp?(s.sa/s.gp).toFixed(2):'0.00'}</td>
            </tr>
            <tr>
              <td style="padding:8px 12px;">Save %</td><td style="padding:8px 12px;text-align:right;font-weight:600;color:var(--ice);">${(sv*100).toFixed(1)}%</td>
              <td style="padding:8px 12px;text-align:right;color:var(--text2);">—</td>
            </tr>
          </tbody>
        </table>
      </div>`;
    } else {
      const pts = calcPTS(p);
      html += `
      <div style="margin-bottom:16px;font-size:13px;color:var(--text2);">Season ${state.season} Statistics</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px;margin-bottom:20px;">
        <div class="stat-card"><div class="stat-card-label">GP</div><div class="stat-card-val">${s.gp||0}</div></div>
        <div class="stat-card"><div class="stat-card-label">G</div><div class="stat-card-val good">${s.g||0}</div></div>
        <div class="stat-card"><div class="stat-card-label">A</div><div class="stat-card-val">${s.a||0}</div></div>
        <div class="stat-card"><div class="stat-card-label">PTS</div><div class="stat-card-val" style="color:var(--gold);">${pts}</div></div>
        <div class="stat-card"><div class="stat-card-label">+/-</div><div class="stat-card-val ${s.pm>=0?'good':'bad'}">${s.pm>=0?'+':''}${s.pm||0}</div></div>
      </div>
      <div style="background:var(--rink2);border:1px solid var(--border);border-radius:8px;overflow:hidden;">
        <table width="100%" style="border-collapse:collapse;font-size:13px;">
          <thead><tr style="border-bottom:1px solid var(--border);">
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:var(--text2);font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">Stat</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;color:var(--text2);font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">Value</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;color:var(--text2);font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">Per Game</th>
          </tr></thead>
          <tbody>
            <tr style="border-bottom:1px solid rgba(100,160,220,0.07);">
              <td style="padding:8px 12px;">Goals</td><td style="padding:8px 12px;text-align:right;font-weight:600;color:#2ecc71;">${s.g||0}</td>
              <td style="padding:8px 12px;text-align:right;color:var(--text2);">${s.gp?(s.g/s.gp).toFixed(2):'0.00'}</td>
            </tr>
            <tr style="border-bottom:1px solid rgba(100,160,220,0.07);">
              <td style="padding:8px 12px;">Assists</td><td style="padding:8px 12px;text-align:right;font-weight:600;">${s.a||0}</td>
              <td style="padding:8px 12px;text-align:right;color:var(--text2);">${s.gp?(s.a/s.gp).toFixed(2):'0.00'}</td>
            </tr>
            <tr style="border-bottom:1px solid rgba(100,160,220,0.07);">
              <td style="padding:8px 12px;">Points</td><td style="padding:8px 12px;text-align:right;font-weight:600;color:var(--gold);">${pts}</td>
              <td style="padding:8px 12px;text-align:right;color:var(--text2);">${s.gp?(pts/s.gp).toFixed(2):'0.00'}</td>
            </tr>
            <tr>
              <td style="padding:8px 12px;">+/-</td><td style="padding:8px 12px;text-align:right;font-weight:600;color:${s.pm>=0?'#2ecc71':'var(--red2)'};">${s.pm>=0?'+':''}${s.pm||0}</td>
              <td style="padding:8px 12px;text-align:right;color:var(--text2);">—</td>
            </tr>
          </tbody>
        </table>
      </div>`;
    }
  }

  // Career History tab
  if(playerPageTab==='playoffs'){
    const ps = p.playoffStats || freshPlayoffStats(p.pos);
    const isGoalie = p.pos === 'G';
    html += `<div style="margin-bottom:12px;font-size:13px;color:var(--text2);">Current Playoff Stats</div>`;
    if(isGoalie){
      const sv = ps.sa>0?(ps.saves/ps.sa*100).toFixed(1):'0.0';
      const gaa = ps.gp>0?(ps.ga/ps.gp).toFixed(2):'0.00';
      html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px;">
        <div class="stat-card"><div class="stat-card-label">GP</div><div class="stat-card-val">${ps.gp||0}</div></div>
        <div class="stat-card"><div class="stat-card-label">W</div><div class="stat-card-val good">${ps.w||0}</div></div>
        <div class="stat-card"><div class="stat-card-label">L</div><div class="stat-card-val bad">${ps.l||0}</div></div>
        <div class="stat-card"><div class="stat-card-label">GA</div><div class="stat-card-val">${ps.ga||0}</div></div>
        <div class="stat-card"><div class="stat-card-label">SV%</div><div class="stat-card-val" style="font-size:18px;">${sv}%</div></div>
        <div class="stat-card"><div class="stat-card-label">GAA</div><div class="stat-card-val" style="font-size:18px;">${gaa}</div></div>
      </div>`;
    } else {
      const pts = (ps.g||0)+(ps.a||0);
      html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px;">
        <div class="stat-card"><div class="stat-card-label">GP</div><div class="stat-card-val">${ps.gp||0}</div></div>
        <div class="stat-card"><div class="stat-card-label">G</div><div class="stat-card-val good">${ps.g||0}</div></div>
        <div class="stat-card"><div class="stat-card-label">A</div><div class="stat-card-val">${ps.a||0}</div></div>
        <div class="stat-card"><div class="stat-card-label">PTS</div><div class="stat-card-val" style="color:var(--gold);">${pts}</div></div>
        <div class="stat-card"><div class="stat-card-label">+/-</div><div class="stat-card-val ${(ps.pm||0)>=0?'good':'bad'}">${(ps.pm||0)>=0?'+':''}${ps.pm||0}</div></div>
      </div>
      <div style="margin-top:12px;background:var(--rink2);border:1px solid var(--border);border-radius:8px;overflow:hidden;">
        <table width="100%" style="border-collapse:collapse;font-size:13px;">
          <thead><tr style="border-bottom:1px solid var(--border);">
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:var(--text2);font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">Stat</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;color:var(--text2);font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">Value</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;color:var(--text2);font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">Per Game</th>
          </tr></thead>
          <tbody>
            <tr style="border-bottom:1px solid rgba(100,160,220,0.07);">
              <td style="padding:8px 12px;">Goals</td>
              <td style="padding:8px 12px;text-align:right;font-weight:600;color:#2ecc71;">${ps.g||0}</td>
              <td style="padding:8px 12px;text-align:right;color:var(--text2);">${ps.gp?(ps.g/ps.gp).toFixed(2):'0.00'}</td>
            </tr>
            <tr style="border-bottom:1px solid rgba(100,160,220,0.07);">
              <td style="padding:8px 12px;">Assists</td>
              <td style="padding:8px 12px;text-align:right;font-weight:600;">${ps.a||0}</td>
              <td style="padding:8px 12px;text-align:right;color:var(--text2);">${ps.gp?(ps.a/ps.gp).toFixed(2):'0.00'}</td>
            </tr>
            <tr>
              <td style="padding:8px 12px;">Points</td>
              <td style="padding:8px 12px;text-align:right;font-weight:600;color:var(--gold);">${pts}</td>
              <td style="padding:8px 12px;text-align:right;color:var(--text2);">${ps.gp?(pts/ps.gp).toFixed(2):'0.00'}</td>
            </tr>
          </tbody>
        </table>
      </div>`;
    }
    if(!ps.gp) html += `<div style="color:var(--text2);font-size:13px;margin-top:8px;font-style:italic;">No playoff games played yet this postseason.</div>`;
  }

  if(playerPageTab==='history'){
    const history = p.seasonHistory || [];
    const cs = p.stats || freshStats(p.pos); // current in-progress season stats
    const currentSeason = state.season || 1;
    const currentTeamName = found.teamName || (found.source === 'fa' ? 'Free Agent' : state.myTeam.name);
    const hasCurrentStats = cs.gp > 0;
    const totalSeasons = history.length + (hasCurrentStats ? 1 : 0);

    if(!history.length && !hasCurrentStats){
      html += `<div style="color:var(--text2);font-size:13px;padding:20px 0;">No career history yet — stats are archived at the end of each season.</div>`;
    } else {
      html += `<div style="margin-bottom:12px;font-size:13px;color:var(--text2);">${totalSeasons} season${totalSeasons!==1?'s':''} on record</div>`;
      if(isGoalie){
        const curSV  = cs.sa>0  ? (cs.saves/cs.sa*100).toFixed(1)+'%' : '—';
        const curGAA = cs.gp>0  ? (cs.ga/cs.gp).toFixed(2)            : '—';
        html += `<table width="100%" style="border-collapse:collapse;font-size:13px;">
          <thead><tr style="border-bottom:1px solid var(--border);">
            ${['Season','Team','GP','W','L','GA','SV%','GAA'].map(h=>`<th style="padding:7px 10px;text-align:left;font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">${h}</th>`).join('')}
          </tr></thead><tbody>
          ${[...history].map(s=>{
            const sv = s.sa>0 ? (s.saves/s.sa*100).toFixed(1)+'%' : '—';
            const gaa = s.gp>0 ? (s.ga/s.gp).toFixed(2) : '—';
            return `<tr style="border-bottom:1px solid rgba(100,160,220,0.07);">
              <td style="padding:7px 10px;font-weight:600;">${s.season}</td>
              <td style="padding:7px 10px;color:var(--text2);">${s.team||'—'}${s.traded?'<span style="font-size:9px;color:var(--text2);margin-left:4px;">(traded)</span>':''}</td>
              <td style="padding:7px 10px;">${s.gp||0}</td>
              <td style="padding:7px 10px;color:#2ecc71;">${s.w||0}</td>
              <td style="padding:7px 10px;color:var(--red2);">${s.l||0}</td>
              <td style="padding:7px 10px;">${s.ga||0}</td>
              <td style="padding:7px 10px;">${sv}</td>
              <td style="padding:7px 10px;">${gaa}</td>
            </tr>`;
          }).join('')}
          ${hasCurrentStats ? `<tr style="border-bottom:1px solid rgba(100,160,220,0.07);background:rgba(255,255,255,0.04);">
            <td style="padding:7px 10px;font-weight:600;">${currentSeason} <span style="font-size:10px;color:var(--accent);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">★ Active</span></td>
            <td style="padding:7px 10px;color:var(--text2);">${currentTeamName}</td>
            <td style="padding:7px 10px;">${cs.gp||0}</td>
            <td style="padding:7px 10px;color:#2ecc71;">${cs.w||0}</td>
            <td style="padding:7px 10px;color:var(--red2);">${cs.l||0}</td>
            <td style="padding:7px 10px;">${cs.ga||0}</td>
            <td style="padding:7px 10px;">${curSV}</td>
            <td style="padding:7px 10px;">${curGAA}</td>
          </tr>` : ''}
          </tbody></table>`;
      } else {
        const curPts = (cs.g||0)+(cs.a||0);
        html += `<table width="100%" style="border-collapse:collapse;font-size:13px;">
          <thead><tr style="border-bottom:1px solid var(--border);">
            ${['Season','Team','GP','G','A','PTS','+/-'].map(h=>`<th style="padding:7px 10px;text-align:left;font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">${h}</th>`).join('')}
          </tr></thead><tbody>
          ${[...history].map(s=>{
            const pts = (s.g||0)+(s.a||0);
            return `<tr style="border-bottom:1px solid rgba(100,160,220,0.07);">
              <td style="padding:7px 10px;font-weight:600;">${s.season}</td>
              <td style="padding:7px 10px;color:var(--text2);">${s.team||'—'}${s.traded?'<span style="font-size:9px;color:var(--text2);margin-left:4px;">(traded)</span>':''}</td>
              <td style="padding:7px 10px;">${s.gp||0}</td>
              <td style="padding:7px 10px;color:#2ecc71;">${s.g||0}</td>
              <td style="padding:7px 10px;">${s.a||0}</td>
              <td style="padding:7px 10px;font-weight:700;color:var(--gold);">${pts}</td>
              <td style="padding:7px 10px;color:${(s.pm||0)>=0?'#2ecc71':'var(--red2)'};">${(s.pm||0)>=0?'+':''}${s.pm||0}</td>
            </tr>`;
          }).join('')}
          ${hasCurrentStats ? `<tr style="border-bottom:1px solid rgba(100,160,220,0.07);background:rgba(255,255,255,0.04);">
            <td style="padding:7px 10px;font-weight:600;">${currentSeason} <span style="font-size:10px;color:var(--accent);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">★ Active</span></td>
            <td style="padding:7px 10px;color:var(--text2);">${currentTeamName}</td>
            <td style="padding:7px 10px;">${cs.gp||0}</td>
            <td style="padding:7px 10px;color:#2ecc71;">${cs.g||0}</td>
            <td style="padding:7px 10px;">${cs.a||0}</td>
            <td style="padding:7px 10px;font-weight:700;color:var(--gold);">${curPts}</td>
            <td style="padding:7px 10px;color:${(cs.pm||0)>=0?'#2ecc71':'var(--red2)'};">${(cs.pm||0)>=0?'+':''}${cs.pm||0}</td>
          </tr>` : ''}
          </tbody></table>`;
      }
    }
  }

  // Career Totals tab
  if(playerPageTab==='career'){
    const ct = p.careerTotals || freshCareerTotals(p.pos);
    const seasons = (p.seasonHistory||[]).length;
    html += `<div style="margin-bottom:16px;font-size:13px;color:var(--text2);">${seasons} season${seasons!==1?'s':''} played</div>`;
    if(isGoalie){
      const careerSV = ct.sa>0 ? (ct.saves/ct.sa*100).toFixed(1) : '0.0';
      const careerGAA = ct.gp>0 ? (ct.ga/ct.gp).toFixed(2) : '0.00';
      html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;">
        <div class="stat-card"><div class="stat-card-label">Career GP</div><div class="stat-card-val">${ct.gp||0}</div></div>
        <div class="stat-card"><div class="stat-card-label">Career W</div><div class="stat-card-val good">${ct.w||0}</div></div>
        <div class="stat-card"><div class="stat-card-label">Career L</div><div class="stat-card-val bad">${ct.l||0}</div></div>
        <div class="stat-card"><div class="stat-card-label">Career GA</div><div class="stat-card-val">${ct.ga||0}</div></div>
        <div class="stat-card"><div class="stat-card-label">Career SV%</div><div class="stat-card-val" style="font-size:18px;">${careerSV}%</div></div>
        <div class="stat-card"><div class="stat-card-label">Career GAA</div><div class="stat-card-val" style="font-size:18px;">${careerGAA}</div></div>
        <div class="stat-card"><div class="stat-card-label">Saves</div><div class="stat-card-val">${ct.saves||0}</div></div>
      </div>`;
    } else {
      const careerPTS = (ct.g||0)+(ct.a||0);
      html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:20px;">
        <div class="stat-card"><div class="stat-card-label">Career GP</div><div class="stat-card-val">${ct.gp||0}</div></div>
        <div class="stat-card"><div class="stat-card-label">Career G</div><div class="stat-card-val good">${ct.g||0}</div></div>
        <div class="stat-card"><div class="stat-card-label">Career A</div><div class="stat-card-val">${ct.a||0}</div></div>
        <div class="stat-card"><div class="stat-card-label">Career PTS</div><div class="stat-card-val" style="color:var(--gold);">${careerPTS}</div></div>
        <div class="stat-card"><div class="stat-card-label">Career +/-</div><div class="stat-card-val ${(ct.pm||0)>=0?'good':'bad'}">${(ct.pm||0)>=0?'+':''}${ct.pm||0}</div></div>
      </div>
      <div style="background:var(--rink2);border:1px solid var(--border);border-radius:8px;padding:14px;">
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Per Season Averages</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;font-size:13px;">
          <div><div style="color:var(--text2);font-size:11px;margin-bottom:2px;">GP/Season</div><div style="font-weight:600;">${seasons>0?(ct.gp/seasons).toFixed(1):'—'}</div></div>
          <div><div style="color:var(--text2);font-size:11px;margin-bottom:2px;">G/Season</div><div style="font-weight:600;">${seasons>0?((ct.g||0)/seasons).toFixed(1):'—'}</div></div>
          <div><div style="color:var(--text2);font-size:11px;margin-bottom:2px;">PTS/Season</div><div style="font-weight:600;">${seasons>0?(careerPTS/seasons).toFixed(1):'—'}</div></div>
        </div>
      </div>`;
    }
  }

  if(playerPageTab==='contract'){
    const capPct = salaryToCapPct(p.salary);
    const totalValue = p.salary * p.years;
    const projCap = league.salaryCap;

    html += `<div style="margin-bottom:16px;">
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Contract Breakdown</div>

      <!-- Summary cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:20px;">
        <div class="stat-card"><div class="stat-card-label">Annual Salary</div><div class="stat-card-val" style="font-size:18px;">$${p.salary.toFixed(2)}M${p.pendingExtension?` <span style="font-size:10px;color:#2ecc71;font-weight:700;">→ $${p.pendingExtension.salary.toFixed(2)}M</span>`:''}</div></div>
        <div class="stat-card"><div class="stat-card-label">Cap Hit %</div><div class="stat-card-val" style="font-size:18px;">${capPct.toFixed(2)}%</div></div>
        <div class="stat-card"><div class="stat-card-label">Years Left</div><div class="stat-card-val ${p.years===1?'bad':p.years===2?'warn':''}">${p.years}yr${p.isELC?' (ELC)':''}${p.pendingExtension?` <span style="font-size:10px;color:#2ecc71;">(+${p.pendingExtension.years}yr ext)</span>`:''}</div></div>
        <div class="stat-card"><div class="stat-card-label">Total Value</div><div class="stat-card-val" style="font-size:18px;">$${(p.pendingExtension?((p.years-p.pendingExtension.years)*p.salary+p.pendingExtension.years*p.pendingExtension.salary):totalValue).toFixed(2)}M</div></div>
        ${p.clause ? `<div class="stat-card"><div class="stat-card-label">Clause</div><div class="stat-card-val" style="font-size:15px;">${clauseBadge(p)} ${p.clause}</div></div>` : ''}
      </div>
      ${p.clause ? `<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:6px;padding:12px 14px;margin-bottom:14px;font-size:13px;">
        <div style="font-weight:700;margin-bottom:4px;">
          ${p.clause==='NMC'?'🚫 No-Movement Clause':p.clause==='M-NMC'?'⚠️ Modified No-Movement Clause':'🔵 No-Trade Clause'}
        </div>
        <div style="color:var(--text2);font-size:12px;">
          ${p.clause==='NMC'?'This player cannot be traded or sent to the minors.':
            p.clause==='M-NMC'?`NMC for first ${Math.ceil(p.clauseYears/2)} years of the deal, then converts to NTC.`:
            'This player has submitted a list of 10 teams they cannot be traded to.'}
        </div>
        ${p.ntcList && p.ntcList.length ? `<div style="margin-top:8px;">
          <div style="font-size:11px;color:var(--text2);margin-bottom:5px;">Blocked teams (${p.ntcList.length}):</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;">
            ${p.ntcList.map(t=>`<span style="font-size:11px;padding:2px 8px;border-radius:3px;background:rgba(192,57,43,0.12);color:var(--red2);border:1px solid rgba(192,57,43,0.25);">${t}</span>`).join('')}
          </div>
        </div>` : ''}
      </div>` : ''}

      <!-- Year-by-year breakdown -->
      <div style="background:var(--rink2);border:1px solid var(--border);border-radius:8px;overflow:hidden;">
        <div style="padding:10px 14px;border-bottom:1px solid var(--border);font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1px;">
          Year-by-Year
        </div>
        <table width="100%" style="border-collapse:collapse;font-size:13px;">
          <thead><tr style="border-bottom:1px solid var(--border);">
            <th style="padding:8px 14px;text-align:left;font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Season</th>
            <th style="padding:8px 14px;text-align:right;font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Age</th>
            <th style="padding:8px 14px;text-align:right;font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Salary</th>
            <th style="padding:8px 14px;text-align:right;font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Cap %</th>
            <th style="padding:8px 14px;text-align:right;font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Cap (proj.)</th>
          </tr></thead>
          <tbody>
            ${Array.from({length: p.years}, (_, i) => {
              const yr = state.season + i;
              const age = p.age + i;
              const projectedCap = Math.round((league.salaryCap + i * 3) * 10) / 10;
              // If player has a pending extension, show current salary for original years,
              // then the extension salary for the queued years
              const ext = p.pendingExtension;
              const originalYears = ext ? p.years - ext.years : p.years;
              const isExtYear = ext && i >= originalYears;
              const rowSalary = isExtYear ? ext.salary : p.salary;
              const projPct = (rowSalary / projectedCap * 100).toFixed(2);
              const isCurrentYear = i === 0;
              return `<tr style="border-bottom:1px solid rgba(100,160,220,0.07);background:${isExtYear?'rgba(46,204,113,0.04)':isCurrentYear?'rgba(41,128,185,0.06)':'transparent'};">
                <td style="padding:10px 14px;font-weight:${isCurrentYear?'700':'400'};color:${isCurrentYear?'var(--ice)':'var(--text)'};">
                  Season ${yr}${isCurrentYear?' <span style="font-size:10px;color:var(--accent);">(current)</span>':''}
                  ${isExtYear&&i===originalYears?' <span style="font-size:10px;color:#2ecc71;font-weight:700;">(ext. kicks in)</span>':''}
                </td>
                <td style="padding:10px 14px;text-align:right;color:var(--text2);">${age}</td>
                <td style="padding:10px 14px;text-align:right;font-weight:600;font-family:'Barlow Condensed',sans-serif;font-size:16px;color:${isExtYear?'#2ecc71':'var(--text)'};">$${rowSalary.toFixed(2)}M</td>
                <td style="padding:10px 14px;text-align:right;color:var(--text2);">${projPct}%</td>
                <td style="padding:10px 14px;text-align:right;color:var(--text2);font-size:12px;">~$${projectedCap}M</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        <!-- Total row -->
        <div style="padding:10px 14px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
          <span style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:13px;color:var(--text2);text-transform:uppercase;letter-spacing:0.8px;">Total Commitment</span>
          <span style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:20px;color:var(--gold);">$${totalValue.toFixed(2)}M</span>
        </div>
      </div>

      <!-- Draft info if available -->
      ${p.draftInfo ? `<div style="margin-top:14px;background:var(--rink2);border:1px solid var(--border);border-radius:8px;padding:12px 14px;font-size:13px;">
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Draft Info</div>
        <div style="display:flex;gap:20px;flex-wrap:wrap;">
          <div><span style="color:var(--text2);">Round: </span><strong>Round ${p.draftInfo.round}</strong></div>
          <div><span style="color:var(--text2);">Pick: </span><strong>#${p.draftInfo.pick}</strong></div>
          <div><span style="color:var(--text2);">Season: </span><strong>${p.draftInfo.season}</strong></div>
          <div><span style="color:var(--text2);">Team: </span><strong>${p.draftInfo.team}</strong></div>
        </div>
      </div>` : ''}
    </div>`;
  }

  html += `<div style="margin-top:20px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    ${isFA ? `<button class="btn btn-gold" onclick="openSign('${p.id}');closePlayerPage();">Make Offer</button>` : isOtherTeam
      ? `<span style="font-size:13px;color:var(--text2);">Scouting view — roster moves are not available for other teams.</span>`
      : `<button class="btn btn-gold" onclick="openExtend('${p.id}')">Extend Contract</button>
      <button class="btn" onclick="sendToAHL('${p.id}');closePlayerPage();">↓ Send to AHL</button>
      <button class="btn" style="color:var(--red2);border-color:rgba(192,57,43,0.3);" onclick="openRelease('${p.id}');closePlayerPage();">Cut Player</button>`}
  </div>`;

  el.innerHTML = html;
}

function setPlayerTab(tab){
  playerPageTab = tab;
  renderPlayerPage();
}

// ---- Calendar Tab ----
function renderCalendar(){ if(!gameStarted) return;
  const el = document.getElementById('calendar-body');
  if(!el) return;
  const cal = state.calendar;
  const phase = cal.phase;
  const totalWeeks = cal.regularSeasonWeeks;
  const currentWeek = cal.week;
  const byDate = (state.schedule && state.schedule.byDate) || {};
  const myName = state.myTeam.name;
  const viewMonth = cal.viewMonth || 0;
  const gp = (state.myTeam.w||0)+(state.myTeam.l||0)+(state.myTeam.otl||0);
  const DOW_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const month = SEASON_MONTHS[viewMonth];
  const seasonDayOfMonth1 = SEASON_MONTHS.slice(0,viewMonth).reduce((s,m)=>s+m.days,0);
  const dow1st = (seasonDayOfMonth1 + 1) % 7;
  const todayMonth = cal.currentMonth;
  const todayDay = cal.currentDay;
  const calYear = cal.viewYear != null ? cal.viewYear : (viewMonth >= 3 ? cal.year + 1 : cal.year);
  // The calendar year of the current season (for year-aware isToday/isPast)
  const todayCalYear = cal.currentMonth >= 3 ? cal.year + 1 : cal.year;
  // Only show game data when viewing the current season; other years have no schedule loaded
  const isViewingCurrentSeason = (calYear === todayCalYear);
  let html = '';

  html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
    <div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:800;">${cal.year}–${(cal.year+1).toString().slice(2)} Regular Season</div>
      <div style="font-size:13px;color:var(--text2);margin-top:2px;">
        <strong style="color:var(--gold);">${phase}</strong>
        ${phase===PHASES.REGULAR_SEASON||phase===PHASES.TRADE_DEADLINE?` · ${SEASON_MONTHS[cal.currentMonth].name} ${cal.currentDay} · ${gp} GP`:''}
      </div>
    </div>
    <div style="display:flex;gap:6px;align-items:center;">
      <button class="btn" onclick="calPrevMonth()" style="padding:5px 12px;">◀</button>
      <span style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;min-width:120px;text-align:center;">${month.name} ${calYear}</span>
      <button class="btn" onclick="calNextMonth()" style="padding:5px 12px;">▶</button>
    </div>
  </div>`;

  if(phase===PHASES.REGULAR_SEASON||phase===PHASES.TRADE_DEADLINE){
    const rsEndDay  = phaseDateToSeasonDay(PHASE_DATES.regularSeasonEnd.month, PHASE_DATES.regularSeasonEnd.day);
    const todaySeasonDay = calSeasonDay(cal);
    const pct = Math.min(100, (todaySeasonDay / rsEndDay * 100)).toFixed(1);
    const tdSeasonDay = phaseDateToSeasonDay(PHASE_DATES.tradeDeadline.month, PHASE_DATES.tradeDeadline.day);
    const pastDeadline = todaySeasonDay >= tdSeasonDay;
    const tdLabel = pastDeadline
      ? '· Trade deadline passed'
      : `· 🔔 Trade deadline ${PHASE_DATES.tradeDeadline.month} ${PHASE_DATES.tradeDeadline.day}`;
    const rsEndLabel = `Season ends ${PHASE_DATES.regularSeasonEnd.month} ${PHASE_DATES.regularSeasonEnd.day}`;
    html += `<div style="background:var(--rink2);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:6px;">
        <span>${gp} games played ${tdLabel}</span>
        <span>${rsEndLabel}</span>
      </div>
      <div style="height:5px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,var(--accent),#2ecc71);border-radius:3px;"></div>
      </div>
    </div>`;
  }

  html += `<div style="background:var(--rink2);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:16px;">
    <div style="display:grid;grid-template-columns:repeat(7,1fr);border-bottom:1px solid var(--border);">`;
  DOW_LABELS.forEach(d => { html += `<div style="text-align:center;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;color:var(--text2);letter-spacing:0.5px;padding:8px 0;">${d}</div>`; });
  html += `</div><div style="display:grid;grid-template-columns:repeat(7,1fr);">`;

  for(let e=0;e<dow1st;e++) html += `<div style="min-height:72px;border-right:1px solid rgba(100,160,220,0.06);border-bottom:1px solid rgba(100,160,220,0.06);"></div>`;

  for(let day=1;day<=month.days;day++){
    const col=(dow1st+day-1)%7;
    const dk=dateKey(viewMonth,day);
    const games=isViewingCurrentSeason?(byDate[dk]||[]):[];
    const myGame=games.find(g=>g.home===myName||g.away===myName);
    const dayOfSeason=seasonDayOfMonth1+day-1;
    const dow=(dayOfSeason+1)%7;
    const isToday=isViewingCurrentSeason&&viewMonth===todayMonth&&day===todayDay&&calYear===todayCalYear;
    const isPast=calYear<todayCalYear||(isViewingCurrentSeason&&(viewMonth<todayMonth||(viewMonth===todayMonth&&day<todayDay)));
    const isTD=PHASE_DATES.tradeDeadline.month===month.name&&PHASE_DATES.tradeDeadline.day===day;
    const isRSEnd=PHASE_DATES.regularSeasonEnd.month===month.name&&PHASE_DATES.regularSeasonEnd.day===day;
    const isDraft=PHASE_DATES.draftDay.month===month.name&&PHASE_DATES.draftDay.day===day;
    const isResign=PHASE_DATES.resignStart.month===month.name&&PHASE_DATES.resignStart.day===day;
    const isFA=PHASE_DATES.freeAgencyStart.month===month.name&&PHASE_DATES.freeAgencyStart.day===day;
    const isPlayoffStart=state.playoffsStarted&&month.name==='April'&&(day===17||day===18);
    const isLastCol=col===6;
    let cellBg='transparent';
    if(isToday) cellBg='rgba(41,128,185,0.18)';
    else if(myGame&&!myGame.result) cellBg='rgba(41,128,185,0.06)';
    else if(isPlayoffStart) cellBg='rgba(243,156,18,0.08)';
    else if(isTD||isRSEnd||isDraft||isResign||isFA) cellBg='rgba(243,156,18,0.04)';
    // Build phase marker badges for this day
    let phaseBadges='';
    if(isTD)          phaseBadges+=`<span style="font-size:8px;background:rgba(243,156,18,0.2);color:#f39c12;border:1px solid rgba(243,156,18,0.4);border-radius:3px;padding:1px 3px;font-weight:700;line-height:1.4;display:block;margin-top:1px;">TDL</span>`;
    if(isRSEnd)       phaseBadges+=`<span style="font-size:8px;background:rgba(46,204,113,0.15);color:#2ecc71;border:1px solid rgba(46,204,113,0.35);border-radius:3px;padding:1px 3px;font-weight:700;line-height:1.4;display:block;margin-top:1px;">RS END</span>`;
    if(isPlayoffStart)phaseBadges+=`<span style="font-size:8px;background:rgba(243,156,18,0.25);color:#f39c12;border:1px solid rgba(243,156,18,0.5);border-radius:3px;padding:1px 3px;font-weight:700;line-height:1.4;display:block;margin-top:1px;">🏒 PLAYOFFS</span>`;
    if(isDraft)       phaseBadges+=`<span style="font-size:8px;background:rgba(93,173,226,0.15);color:#5dade2;border:1px solid rgba(93,173,226,0.3);border-radius:3px;padding:1px 3px;font-weight:700;line-height:1.4;display:block;margin-top:1px;">DRAFT</span>`;
    if(isResign)      phaseBadges+=`<span style="font-size:8px;background:rgba(155,89,182,0.15);color:#bb8fce;border:1px solid rgba(155,89,182,0.3);border-radius:3px;padding:1px 3px;font-weight:700;line-height:1.4;display:block;margin-top:1px;">RE-SIGN</span>`;
    if(isFA)          phaseBadges+=`<span style="font-size:8px;background:rgba(231,76,60,0.15);color:#e74c3c;border:1px solid rgba(231,76,60,0.3);border-radius:3px;padding:1px 3px;font-weight:700;line-height:1.4;display:block;margin-top:1px;">FREE AGCY</span>`;
    // Find any playoff game for my team on this day
    let poGame = null;
    if(state.playoffsStarted && state.bracket){
      state.bracket.rounds.forEach(round => {
        round.forEach(s => {
          if((s.home===myName||s.away===myName) && s.games){
            const pg = s.games.find(g=>g.month===viewMonth&&g.day===day);
            if(pg){ poGame = { series:s, game:pg }; }
          }
        });
      });
    }
    // Check for upcoming (scheduled but not yet played) playoff game on this day
    let upcomingPoGame = null;
    if(state.playoffsStarted && state.bracket && !poGame){
      const thisDayOfSeason = seasonDayOfMonth1 + day - 1;
      const poBase = phaseDateToSeasonDay('April', 18);
      state.bracket.rounds.forEach((round, ri) => {
        round.forEach(s => {
          if(s.done) return;
          if(s.home !== myName && s.away !== myName) return;
          // Compute startSeasonDay on-the-fly if not stamped (handles old saves)
          const ssd = (s.startSeasonDay != null) ? s.startSeasonDay : (poBase + ri * 16);
          const gamesPlayed = (s.games || []).length;
          for(let gn = gamesPlayed; gn < 7; gn++){
            const scheduledDay = ssd + gn * 2;
            if(scheduledDay === thisDayOfSeason){
              upcomingPoGame = { series: s, gameNum: gn + 1, roundIdx: ri };
              break;
            }
          }
        });
      });
    }
    let badge='';
    if(poGame){
      const s=poGame.series, pg=poGame.game;
      const isMyHome=s.home===myName;
      const opp=(isMyHome?s.away:s.home).split(' ').pop();
      const won=isMyHome?pg.homeWin:!pg.homeWin;
      const myG=isMyHome?pg.homeG:pg.awayG;
      const oppG=isMyHome?pg.awayG:pg.homeG;
      const rc=won?'#2ecc71':'#e74c3c';
      badge=`<div style="margin-top:2px;"><div style="font-size:8px;color:#f39c12;font-weight:700;line-height:1.3;">🏒 PLAYOFF</div><div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:800;color:${rc};">${won?'W':'L'} ${myG}–${oppG}</div><div style="font-size:9px;color:var(--text2);">vs ${opp}</div></div>`;
      if(isToday||(!poGame.game.homeWin&&!won)) cellBg='rgba(231,76,60,0.08)';
    } else if(upcomingPoGame){
      const s=upcomingPoGame.series, gn=upcomingPoGame.gameNum;
      const ri=upcomingPoGame.roundIdx;
      const opp=(s.home===myName?s.away:s.home).split(' ').pop();
      const myW=s.home===myName?s.homeW:s.awayW;
      const oppW=s.home===myName?s.awayW:s.homeW;
      // Find the series index within its round
      let si=-1;
      if(state.bracket && state.bracket.rounds[ri]) state.bracket.rounds[ri].forEach((sr,i)=>{ if(sr===s) si=i; });
      cellBg='rgba(243,156,18,0.10)';
      badge=`<div style="margin-top:2px;cursor:pointer;" ${si>=0?`onclick="simOnePlayoffGame(${ri},${si});renderCalendar();"`:''}>
        <div style="font-size:8px;color:#f39c12;font-weight:700;line-height:1.3;">🏒 PO Gm ${gn}</div>
        <div style="font-size:10px;font-weight:700;color:var(--ice);">vs ${opp}</div>
        <div style="font-size:9px;color:var(--text2);">${myW}–${oppW} series${si>=0?' · tap to sim':''}</div>
      </div>`;
    } else if(myGame&&myGame.result){
      const rc=myGame.result==='W'?'#2ecc71':myGame.result==='L'?'#e74c3c':'#f39c12';
      badge=`<div style="margin-top:3px;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:800;color:${rc};">${myGame.result} ${myGame.myG}–${myGame.oppG}</div>`;
    } else if(myGame){
      const isHome=myGame.home===myName;
      const opp=(isHome?myGame.away:myGame.home).split(' ').pop();
      badge=`<div style="margin-top:3px;font-size:10px;font-weight:700;color:${isHome?'#2ecc71':'#f39c12'};">${isHome?'vs':'@'} ${opp}</div>`;
    } else if(GAME_DAYS.includes(dow)&&games.length>0){
      badge=`<div style="display:flex;gap:2px;margin-top:5px;">${Array.from({length:Math.min(games.length,5)},()=>`<div style="width:4px;height:4px;border-radius:50%;background:rgba(100,160,220,0.2);"></div>`).join('')}</div>`;
    }
    const isFuture=!isPast&&!isToday;
    const isSimPhase=(cal.phase===PHASES.REGULAR_SEASON||cal.phase===PHASES.TRADE_DEADLINE);
    const isClickable=isFuture&&isSimPhase&&(myGame||games.length>0);
    const simHint=isClickable?`<div class="cal-sim-hint">&#9654; Sim to here</div>`:'';
    html+=`<div ${isClickable?`onclick="simToDate(${viewMonth},${day})" class="cal-day-clickable"`:''}  style="min-height:72px;padding:5px 6px;background:${cellBg};border-top:1px solid rgba(100,160,220,0.06);border-right:${isLastCol?'none':'1px solid rgba(100,160,220,0.06)'};border-bottom:1px solid rgba(100,160,220,0.06);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:2px;flex-wrap:wrap;">
        <span style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:${isToday?'var(--ice)':isPast?'rgba(255,255,255,0.25)':'var(--text2)'};">${day}</span>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:1px;">
          ${isToday?`<span style="font-size:8px;color:var(--accent);font-weight:700;">TODAY</span>`:''}
          ${phaseBadges}
        </div>
      </div>${badge}${simHint}</div>`;
  }
  html+=`</div></div>`;

  const myMonthGames=[];
  for(let d=1;d<=month.days;d++){
    const mg=isViewingCurrentSeason?(byDate[dateKey(viewMonth,d)]||[]).find(g=>g.home===myName||g.away===myName):undefined;
    if(mg) myMonthGames.push({...mg,day:d});
  }
  if(myMonthGames.length){
    html+=`<div style="background:var(--rink2);border:1px solid var(--border);border-radius:8px;padding:16px;">
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">${month.name} Schedule — ${myMonthGames.length} games</div>`;
    myMonthGames.forEach(g=>{
      const isHome=g.home===myName;
      const opp=isHome?g.away:g.home;
      const oppTeam=getTeamByName(opp);
      const oppOVR=oppTeam?teamOVR(oppTeam.roster):80;
      const dos2=seasonDayOfMonth1+g.day-1;
      const dow2=(dos2+1)%7;
      const isPastGame=calYear<todayCalYear||(isViewingCurrentSeason&&(viewMonth<todayMonth||(viewMonth===todayMonth&&g.day<todayDay)));
      const isFutureGame=!isPastGame&&(calYear>todayCalYear||(isViewingCurrentSeason&&(viewMonth>todayMonth||(viewMonth===todayMonth&&g.day>todayDay))));
      const isSimPhase2=(cal.phase===PHASES.REGULAR_SEASON||cal.phase===PHASES.TRADE_DEADLINE);
      let resultHtml='';
      if(g.result){const rc=g.result==='W'?'#2ecc71':g.result==='L'?'#e74c3c':'#f39c12';resultHtml=`<span style="font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:15px;color:${rc};">${g.result} ${g.myG}–${g.oppG}</span>`;}
      else if(!isPastGame){resultHtml=`<span style="display:flex;align-items:center;gap:8px;"><span style="font-size:11px;color:var(--text2);">OVR ${oppOVR}</span>${isFutureGame&&isSimPhase2?`<button class="btn btn-xs btn-primary" onclick="simToDate(${viewMonth},${g.day})" style="padding:2px 8px;font-size:10px;">&#9654; Sim to</button>`:''}</span>`;}
      html+=`<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(100,160,220,0.07);">
        <div style="min-width:70px;font-size:11px;color:var(--text2);">${DOW_LABELS[dow2]} ${month.name.slice(0,3)} ${g.day}</div>
        <div style="min-width:32px;font-size:11px;font-weight:700;color:${isHome?'#2ecc71':'#f39c12'};">${isHome?'HOME':'AWAY'}</div>
        <div style="flex:1;font-size:13px;font-weight:500;">${opp}</div>
        ${resultHtml}</div>`;
    });
    html+=`</div>`;
  } else {
    if(month.offseason){
      const PD = PHASE_DATES;
      const offPhaseLabels = {
        [PHASES.PLAYOFFS]:    `🏒 Playoffs underway — started April 18. Draft begins ${PD.draftDay.month} ${PD.draftDay.day}.`,
        [PHASES.DRAFT]:       `Entry Draft — ${PD.draftDay.month} ${PD.draftDay.day}. Re-signing opens ${PD.resignStart.month} ${PD.resignStart.day}.`,
        [PHASES.RESIGN]:      `Re-signing window open through ${PD.freeAgencyStart.month} ${PD.freeAgencyStart.day}. Free agency opens then.`,
        [PHASES.FREE_AGENCY]: `Free agency open. Offseason roster building begins ${PD.offseasonStart.month} ${PD.offseasonStart.day}.`,
        [PHASES.OFFSEASON]:   'General offseason — prepare your roster for next season.',
      };
      const offMsg = offPhaseLabels[phase] || 'Offseason — no games scheduled.';
      html+=`<div style="text-align:center;padding:24px 20px;background:rgba(243,156,18,0.06);border:1px solid rgba(243,156,18,0.15);border-radius:8px;">
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:800;color:var(--gold);margin-bottom:6px;">☀️ Offseason</div>
        <div style="font-size:13px;color:var(--text2);">${offMsg}</div>
      </div>`;
    } else {
      html+=`<div style="text-align:center;padding:20px;color:var(--text2);font-size:13px;">No games scheduled in ${month.name}.</div>`;
    }
  }

  // ── Upcoming playoff schedule list for this month ──────────────────────────
  if(state.playoffsStarted && state.bracket){
    const myName3 = myName;
    const upcomingPoList = [];
    const poBase2 = phaseDateToSeasonDay('April', 18);
    state.bracket.rounds.forEach((round, ri) => {
      round.forEach(s => {
        if(s.done) return;
        if(s.home !== myName3 && s.away !== myName3) return;
        const ssd2 = (s.startSeasonDay != null) ? s.startSeasonDay : (poBase2 + ri * 16);
        const gamesPlayed = (s.games || []).length;
        for(let gn = gamesPlayed; gn < 7; gn++){
          const scheduledDay = ssd2 + gn * 2;
          // Convert to month+day
          let rem3 = scheduledDay, gMonth3 = 0;
          while(gMonth3 < SEASON_MONTHS.length-1 && rem3 >= SEASON_MONTHS[gMonth3].days){
            rem3 -= SEASON_MONTHS[gMonth3].days; gMonth3++;
          }
          const gDay3 = rem3 + 1;
          if(gMonth3 === viewMonth){
            upcomingPoList.push({ series: s, roundIdx: ri, gameNum: gn+1, month: gMonth3, day: gDay3 });
          }
        }
      });
    });

    if(upcomingPoList.length){
      const roundNames2 = ['First Round','Second Round','Conference Finals','Stanley Cup Final'];
      html+=`<div style="background:var(--rink2);border:1px solid rgba(243,156,18,0.3);border-radius:8px;padding:16px;margin-bottom:16px;">
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:700;color:#f39c12;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">🏒 Upcoming Playoff Games — ${month.name}</div>`;
      upcomingPoList.sort((a,b)=>a.day-b.day).forEach(item=>{
        const s=item.series;
        const isHome=s.home===myName3;
        const opp=isHome?s.away:s.home;
        const myW=isHome?s.homeW:s.awayW;
        const oppW=isHome?s.awayW:s.homeW;
        const dow3=(item.day-1+SEASON_MONTHS.slice(0,viewMonth).reduce((a,m)=>a+m.days,0)+1)%7;
        const rName=roundNames2[item.roundIdx]||`Round ${item.roundIdx+1}`;
        // Find round/series indices for button calls
        let calRi=-1, calSi=-1;
        state.bracket.rounds.forEach((round,ri)=>{ round.forEach((ser,si)=>{ if(ser===s){calRi=ri;calSi=si;} }); });
        html+=`<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(100,160,220,0.07);">
          <div style="min-width:70px;font-size:11px;color:var(--text2);">${DOW_LABELS[dow3]} ${month.name.slice(0,3)} ${item.day}</div>
          <div style="min-width:28px;"><span style="font-size:9px;font-weight:700;padding:1px 4px;border-radius:3px;background:rgba(243,156,18,0.15);color:#f39c12;border:1px solid rgba(243,156,18,0.3);">Gm ${item.gameNum}</span></div>
          <div style="flex:1;font-size:13px;font-weight:500;">${opp} <span style="font-size:11px;color:var(--text2);">${rName} · series ${myW}–${oppW}</span></div>
          ${calRi>=0?`<button class="btn btn-xs btn-gold" onclick="simOnePlayoffGame(${calRi},${calSi});renderCalendar();">▶ Sim</button>`:''}
        </div>`;
      });
      html+=`</div>`;
    }
  }

  // ── Playoff series block (show if playoffs started and April or later) ──
  if(state.playoffsStarted && state.bracket && viewMonth >= 6){
    const myName2 = myName;
    // Find all series involving my team across all rounds
    const mySeries = [];
    state.bracket.rounds.forEach((round, ri) => {
      round.forEach(s => {
        // Match by name — trim whitespace just in case
        const sh = (s.home||'').trim(), sa = (s.away||'').trim(), mn = myName2.trim();
        if(sh === mn || sa === mn) mySeries.push({...s, home: sh, away: sa, roundIndex: ri});
      });
    });

    // Always show a playoff banner when on April+ even if team name didn't match
    if(!mySeries.length){
      const currentRound = state.bracket.rounds[state.bracket.rounds.length-1];
      const allDone = currentRound.every(s=>s.done);
      html += `<div style="background:rgba(243,156,18,0.08);border:1px solid rgba(243,156,18,0.25);border-radius:8px;padding:16px;margin-bottom:14px;">
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">🏆 Playoffs — April 18</div>
        <div style="font-size:13px;color:var(--text2);margin-bottom:10px;">The bracket has been set. Sim your series below or from the Playoffs tab.</div>
        ${!allDone ? `<button class="btn btn-gold btn-sm" onclick="simAllSeries();renderCalendar();">⏩ Sim All Current Series</button>` : `<button class="btn btn-primary btn-sm" onclick="calCheckAdvanceRound();renderCalendar();">Next Round →</button>`}
      </div>`;
    }

    if(mySeries.length){
      const roundNames = ['First Round','Second Round','Conference Finals','Stanley Cup Final'];
      // Show all rounds that are accessible (current and past)
      const currentRoundIdx = state.bracket.rounds.length - 1;
      mySeries.forEach(series => {
        const rName = roundNames[series.roundIndex] || `Round ${series.roundIndex+1}`;
        const isHome = series.home === myName2;
        const opp = isHome ? series.away : series.home;
        const myW = isHome ? series.homeW : series.awayW;
        const oppW = isHome ? series.awayW : series.homeW;
        const seriesGames = series.games || [];

        const notYetSimmed = !series.done && seriesGames.length === 0;
        const statusColor = series.done
          ? (series.winner === myName2 ? '#2ecc71' : '#e74c3c')
          : '#f39c12';
        const statusLabel = series.done
          ? (series.winner === myName2 ? '✅ WON' : '❌ ELIMINATED')
          : notYetSimmed ? '⏳ UPCOMING' : '🏒 IN PROGRESS';

        // Estimate which month this series falls in based on round
        const playoffsBase = phaseDateToSeasonDay('April', 18);
        const seriesStartDay = playoffsBase + series.roundIndex * 16;
        let estMonth = 0;
        let rem2 = seriesStartDay;
        while(estMonth < SEASON_MONTHS.length-1 && rem2 >= SEASON_MONTHS[estMonth].days){
          rem2 -= SEASON_MONTHS[estMonth].days; estMonth++;
        }
        // Only show this series if we're in or past its estimated month
        if(viewMonth < estMonth) return;

        html += `<div style="background:var(--rink2);border:1px solid ${series.done?(series.winner===myName2?'rgba(46,204,113,0.3)':'rgba(231,76,60,0.3)'):'rgba(243,156,18,0.25)'};border-radius:8px;padding:16px;margin-bottom:14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:6px;">
            <div>
              <div style="font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;">🏆 ${rName}</div>
              <div style="font-size:12px;color:var(--text2);margin-top:2px;">${myName2} vs ${opp}</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:800;">${myW}–${oppW}</div>
              <span style="font-size:10px;font-weight:700;color:${statusColor};border:1px solid ${statusColor};border-radius:3px;padding:2px 6px;">${statusLabel}</span>
            </div>
          </div>`;

        // Find the actual series object reference in the bracket to get roundIdx/seriesIdx for button calls
        let calRoundIdx = -1, calSeriesIdx = -1;
        if(state.bracket){
          state.bracket.rounds.forEach((round, ri) => {
            round.forEach((s, si) => {
              if((s.home||'').trim() === (series.home||'').trim() && (s.away||'').trim() === (series.away||'').trim())
                { calRoundIdx = ri; calSeriesIdx = si; }
            });
          });
        }

        if(seriesGames.length){
          html += `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">`;
          seriesGames.forEach((g, gi) => {
            const isMine = g.month === viewMonth;
            const myGoals = isHome ? g.homeG : g.awayG;
            const oppGoals = isHome ? g.awayG : g.homeG;
            const won = isHome ? g.homeWin : !g.homeWin;
            const rc = won ? '#2ecc71' : '#e74c3c';
            const monthName = SEASON_MONTHS[g.month]?.name?.slice(0,3) || '?';
            html += `<div style="padding:6px 10px;border-radius:5px;border:1px solid ${isMine?'rgba(100,160,220,0.3)':'rgba(100,160,220,0.1)'};background:${isMine?'rgba(41,128,185,0.1)':'rgba(255,255,255,0.02)'};min-width:80px;text-align:center;">
              <div style="font-size:10px;color:var(--text2);margin-bottom:2px;">Gm ${gi+1} · ${monthName} ${g.day}</div>
              <div style="font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:800;color:${rc};">${won?'W':'L'} ${myGoals}–${oppGoals}</div>
            </div>`;
          });
          html += `</div>`;
        }

        // Sim controls — always show if series not done
        if(!series.done && calRoundIdx >= 0){
          html += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
            <button class="btn btn-primary btn-sm" onclick="simOnePlayoffGame(${calRoundIdx},${calSeriesIdx})">▶ Sim Game ${seriesGames.length+1}</button>
            <button class="btn btn-sm" onclick="calSimWholeSeries(${calRoundIdx},${calSeriesIdx})">⏩ Sim Rest of Series</button>
          </div>`;
        } else if(series.done && !seriesGames.length){
          // Done but no game log (shouldn't happen, but just in case)
          html += `<div style="font-size:12px;color:var(--text2);font-style:italic;">Series complete.</div>`;
        }

        html += `</div>`;
      });
    }
  }

  // Phase timeline legend (always show at bottom)
  const PD = PHASE_DATES;
  const legendItems = [
    { label:'Trade Deadline', date:`${PD.tradeDeadline.month} ${PD.tradeDeadline.day}`,   color:'#f39c12' },
    { label:'Season End',     date:`${PD.regularSeasonEnd.month} ${PD.regularSeasonEnd.day}`, color:'#2ecc71' },
    { label:'Entry Draft',    date:`${PD.draftDay.month} ${PD.draftDay.day}`,             color:'#5dade2' },
    { label:'Re-Sign Opens',  date:`${PD.resignStart.month} ${PD.resignStart.day}`,       color:'#bb8fce' },
    { label:'Free Agency',    date:`${PD.freeAgencyStart.month} ${PD.freeAgencyStart.day}`, color:'#e74c3c' },
  ];
  html+=`<div style="margin-top:14px;background:var(--rink2);border:1px solid var(--border);border-radius:8px;padding:12px 16px;">
    <div style="font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Season Phase Dates</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;">
      ${legendItems.map(item=>`<div style="display:flex;align-items:center;gap:5px;">
        <div style="width:8px;height:8px;border-radius:2px;background:${item.color};flex-shrink:0;"></div>
        <span style="font-size:11px;color:var(--text2);">${item.label}: <strong style="color:var(--text);">${item.date}</strong></span>
      </div>`).join('')}
    </div>
  </div>`;
  el.innerHTML = html;
}

function calPrevMonth(){
  if(!state||!state.calendar) return;
  const cal = state.calendar;
  let vm = cal.viewMonth || 0;
  let vy = cal.viewYear || cal.year || 2025;
  vm--;
  if(vm < 0){ vm = SEASON_MONTHS.length - 1; vy--; }
  cal.viewMonth = vm;
  cal.viewYear = vy;
  renderCalendar();
}
function calNextMonth(){
  if(!state||!state.calendar) return;
  const cal = state.calendar;
  let vm = cal.viewMonth || 0;
  let vy = cal.viewYear || cal.year || 2025;
  vm++;
  if(vm >= SEASON_MONTHS.length){ vm = 0; vy++; }
  cal.viewMonth = vm;
  cal.viewYear = vy;
  renderCalendar();
}
// ================================================================
// CONTRACTS TAB — independent contract management UI
// Shows all contract data, cap breakdown, and quick actions.
// Does NOT touch attributes, development, or stats systems.
// ================================================================
function renderContracts(){ if(!gameStarted) return;
  const el = document.getElementById('contracts-body');
  if(!el) return;

  const roster = state.myTeam.roster;
  const cap = league.salaryCap;
  const used = capUsed();
  const left = cap - used;
  const floor = league.capFloor;
  const usedPct = (used/cap*100).toFixed(1);
  const floorPct = (floor/cap*100).toFixed(1);
  const belowFloor = used < floor;

  // Sort roster by salary descending
  const sorted = [...roster].sort((a,b) => b.salary - a.salary);

  // Group by expiry
  const expiringNext = sorted.filter(p => p.years === 1);
  const locked = sorted.filter(p => p.years > 1);

  let html = '';

  // ---- Cap Overview ----
  html += `<div style="background:var(--rink2);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:20px;">
    <div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;">Cap Overview — ${state.calendar?.year||state.season} Season</div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px;">
      <div class="stat-card"><div class="stat-card-label">Salary Cap</div><div class="stat-card-val">$${cap.toFixed(1)}M</div></div>
      <div class="stat-card"><div class="stat-card-label">Cap Used</div><div class="stat-card-val ${used/cap>0.95?'bad':used/cap>0.85?'warn':'good'}">$${used.toFixed(1)}M</div></div>
      <div class="stat-card"><div class="stat-card-label">Cap Space</div><div class="stat-card-val ${left<4?'bad':left<10?'warn':'good'}">$${left.toFixed(1)}M</div></div>
      <div class="stat-card"><div class="stat-card-label">Salary Floor</div><div class="stat-card-val">$${floor.toFixed(1)}M</div></div>
      <div class="stat-card"><div class="stat-card-label">Roster Size</div><div class="stat-card-val">${roster.length}</div></div>
      <div class="stat-card"><div class="stat-card-label">Avg Salary</div><div class="stat-card-val" style="font-size:18px;">$${roster.length?(used/roster.length).toFixed(2):'0.00'}M</div></div>
      ${(state.myTeam.retainedContracts||[]).length ? `<div class="stat-card" style="border-color:rgba(243,156,18,0.35);background:rgba(243,156,18,0.05);"><div class="stat-card-label" style="color:var(--gold);">Retained (Eaten)</div><div class="stat-card-val" style="color:var(--gold);font-size:18px;">$${(state.myTeam.retainedContracts||[]).reduce((s,r)=>s+(r.amt||0),0).toFixed(2)}M</div></div>` : ''}
    </div>

    <!-- Cap bar -->
    <div style="margin-bottom:6px;display:flex;justify-content:space-between;font-size:12px;color:var(--text2);">
      <span>Cap Usage: ${usedPct}%</span>
      <span>Floor: ${floorPct}%</span>
    </div>
    <div style="height:10px;background:rgba(255,255,255,0.08);border-radius:5px;position:relative;overflow:visible;">
      <div style="width:${Math.min(100,usedPct)}%;height:100%;border-radius:5px;background:${used/cap>0.95?'var(--red2)':used/cap>0.85?'var(--gold)':'var(--accent)'}; transition:width 0.3s;"></div>
      <!-- Floor marker -->
      <div style="position:absolute;top:-4px;left:${floorPct}%;width:2px;height:18px;background:var(--gold);border-radius:1px;" title="Salary Floor"></div>
    </div>
    ${belowFloor?`<div style="font-size:12px;color:var(--gold);margin-top:6px;">⚠️ Below salary floor by $${floorDeficit(state.myTeam).toFixed(1)}M — floor adjustment will apply at season start</div>`:''}
  </div>`;

  // ---- Shared table styles ----
  const thS = 'padding:7px 10px;font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.8px;text-align:left;border-bottom:1px solid var(--border);';
  const tdS = 'padding:8px 10px;font-size:13px;border-bottom:1px solid rgba(100,160,220,0.07);vertical-align:middle;';

  // ---- NHL contract row (with Extend/Cut buttons) ----
  function contractRow(p){
    const capPct = salaryToCapPct(p.salary);
    const barW = Math.min(100, capPct/15*100).toFixed(0);
    const expColor = p.years===1?'var(--red2)':p.years===2?'var(--gold)':'#2ecc71';
    const salDisplay = p.isTwoWay && p.nhlSalary
      ? `<span style="font-weight:600;">$${p.salary.toFixed(2)}M</span> <span style="font-size:10px;color:var(--text2);">NHL: $${p.nhlSalary.toFixed(2)}M</span>`
      : `<span style="font-weight:600;">$${p.salary.toFixed(2)}M</span>`;
    return `<tr>
      <td style="${tdS}font-weight:500;cursor:pointer;color:#fff;" onclick="openPlayerPage('${p.id}')">${p.name}</td>
      <td style="${tdS}"><span class="pos-badge">${p.pos}</span></td>
      <td style="${tdS}">${p.age}</td>
      <td style="${tdS}">${p.ovr}</td>
      <td style="${tdS}">
        <div style="display:flex;align-items:center;gap:8px;">
          ${salDisplay}
          <div style="width:60px;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;">
            <div style="width:${barW}%;height:100%;background:var(--accent);border-radius:2px;"></div>
          </div>
        </div>
      </td>
      <td style="${tdS}color:var(--text2);">${capPct.toFixed(2)}%</td>
      <td style="${tdS}font-weight:700;color:${expColor};">${p.years}yr ${p.isELC?'<span style="font-size:10px;font-family:Barlow Condensed,sans-serif;font-weight:700;padding:1px 5px;border-radius:3px;background:rgba(243,156,18,0.15);color:var(--gold);border:1px solid rgba(243,156,18,0.3);">ELC</span>':''} ${clauseBadge(p)}</td>
      <td style="${tdS}color:var(--text2);">$${(p.salary*p.years).toFixed(2)}M</td>
      <td style="${tdS}">
        <div style="display:flex;gap:5px;">
          <button class="btn btn-xs btn-gold" onclick="openExtend('${p.id}')">Extend</button>
          <button class="btn btn-xs" style="color:var(--red2);border-color:rgba(192,57,43,0.3);" onclick="openRelease('${p.id}')">Cut</button>
        </div>
      </td>
    </tr>`;
  }

  // ---- Affiliate contract row (with Call Up button) ----
  function affiliateContractRow(p, fromLeague){
    const expColor = p.years===1?'var(--red2)':p.years===2?'var(--gold)':'#2ecc71';
    // For 2-way players in minors, show minorSalary as current and nhlSalary as NHL rate
    const curSal = p.salary || 0;
    const nhlSal = p.isTwoWay && p.nhlSalary ? p.nhlSalary : null;
    const totalVal = nhlSal ? (nhlSal * p.years) : (curSal * p.years);
    const salDisplay = p.isTwoWay && nhlSal
      ? `<span style="font-weight:600;color:#5dade2;">$${curSal.toFixed(2)}M</span> <span style="font-size:10px;color:var(--text2);">↑NHL $${nhlSal.toFixed(2)}M</span>`
      : `<span style="font-weight:600;color:var(--text2);">$${curSal.toFixed(2)}M</span>`;
    const leagueTag = fromLeague === 'ahl'
      ? `<span style="font-size:10px;font-family:'Barlow Condensed',sans-serif;font-weight:700;padding:1px 6px;border-radius:3px;background:rgba(93,173,226,0.15);color:#5dade2;border:1px solid rgba(93,173,226,0.3);">AHL</span>`
      : `<span style="font-size:10px;font-family:'Barlow Condensed',sans-serif;font-weight:700;padding:1px 6px;border-radius:3px;background:rgba(243,156,18,0.12);color:var(--gold);border:1px solid rgba(243,156,18,0.3);">ECHL</span>`;
    return `<tr>
      <td style="${tdS}font-weight:500;">${p.name} ${leagueTag}</td>
      <td style="${tdS}"><span class="pos-badge">${p.pos}</span></td>
      <td style="${tdS}">${p.age}</td>
      <td style="${tdS}">${p.ovr}</td>
      <td style="${tdS}">${salDisplay}</td>
      <td style="${tdS}color:var(--text2);">—</td>
      <td style="${tdS}font-weight:700;color:${expColor};">${p.years}yr ${p.isELC?'<span style="font-size:10px;font-family:Barlow Condensed,sans-serif;font-weight:700;padding:1px 5px;border-radius:3px;background:rgba(243,156,18,0.15);color:var(--gold);border:1px solid rgba(243,156,18,0.3);">ELC</span>':''} ${clauseBadge(p)}</td>
      <td style="${tdS}color:var(--text2);">$${totalVal.toFixed(2)}M</td>
      <td style="${tdS}">
        <div style="display:flex;gap:5px;">
          <button class="btn btn-xs btn-gold" onclick="callUp('${p.id}','${fromLeague}');renderContracts();">↑ NHL</button>
          ${fromLeague==='ahl'?`<button class="btn btn-xs" style="color:var(--red2);border-color:rgba(192,57,43,0.3);" onclick="sendToECHL('${p.id}');renderContracts();">↓ ECHL</button>`:''}
          ${fromLeague==='echl'?`<button class="btn btn-xs" onclick="callUpFromECHLToAHL('${p.id}');renderContracts();">↑ AHL</button>`:''}
        </div>
      </td>
    </tr>`;
  }

  const colHeaders = `<tr>
    <th style="${thS}">Player</th>
    <th style="${thS}">Pos</th>
    <th style="${thS}">Age</th>
    <th style="${thS}">OVR</th>
    <th style="${thS}">Salary</th>
    <th style="${thS}">Cap %</th>
    <th style="${thS}">Yrs Left</th>
    <th style="${thS}">Total Value</th>
    <th style="${thS}"></th>
  </tr>`;

  // ---- NHL: Active Contracts ----
  html += `<div style="margin-bottom:20px;">
    <div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">
      🏒 NHL — Active Contracts (${locked.length})
    </div>
    <div style="overflow-x:auto;">
    <table width="100%" style="border-collapse:collapse;">
      <thead>${colHeaders}</thead>
      <tbody>${locked.map(p=>contractRow(p)).join('')}</tbody>
    </table></div>
  </div>`;

  // ---- NHL: Expiring Contracts ----
  if(expiringNext.length){
    html += `<div style="margin-bottom:20px;">
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:var(--red2);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">
        ⚠️ NHL — Expiring After This Season (${expiringNext.length})
      </div>
      <div style="overflow-x:auto;">
      <table width="100%" style="border-collapse:collapse;">
        <thead>${colHeaders}</thead>
        <tbody>${expiringNext.map(p=>contractRow(p)).join('')}</tbody>
      </table></div>
    </div>`;
  }

  // ---- AHL Contracts ----
  const ahlRoster = [...(state.ahl?.roster||[])].sort((a,b)=>b.ovr-a.ovr);
  if(ahlRoster.length){
    html += `<div style="margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:#5dade2;text-transform:uppercase;letter-spacing:1px;">
          AHL — ${state.ahl.name} (${ahlRoster.length} players)
        </div>
        <div style="font-size:11px;color:var(--text2);">Minor league salary counts against cap only when on NHL roster</div>
      </div>
      <div style="overflow-x:auto;">
      <table width="100%" style="border-collapse:collapse;">
        <thead>${colHeaders}</thead>
        <tbody>${ahlRoster.map(p=>affiliateContractRow(p,'ahl')).join('')}</tbody>
      </table></div>
    </div>`;
  }

  // ---- ECHL Contracts ----
  const echlRoster = [...(state.echl?.roster||[])].sort((a,b)=>b.ovr-a.ovr);
  if(echlRoster.length){
    html += `<div style="margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:1px;">
          ECHL — ${state.echl.name} (${echlRoster.length} players)
        </div>
      </div>
      <div style="overflow-x:auto;">
      <table width="100%" style="border-collapse:collapse;">
        <thead>${colHeaders}</thead>
        <tbody>${echlRoster.map(p=>affiliateContractRow(p,'echl')).join('')}</tbody>
      </table></div>
    </div>`;
  }

  // ---- Future cap commitments by year ----
  const maxYears = Math.max(...roster.map(p=>p.years), 1);
  html += `<div style="background:var(--rink2);border:1px solid var(--border);border-radius:8px;padding:16px;">
    <div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Future Cap Commitments</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;">
      ${Array.from({length:Math.min(maxYears,8)},(_,i)=>{
        const yr = i+1;
        const committed = roster.filter(p=>p.years>=yr).reduce((s,p)=>s+(p.nhlSalary||p.salary),0);
        const pct = (committed/cap*100).toFixed(1);
        const projCap = Math.round((cap + (yr-1)*3) * 10)/10;
        return `<div style="text-align:center;padding:10px;background:rgba(255,255,255,0.02);border-radius:5px;border:1px solid var(--border);">
          <div style="font-size:11px;color:var(--text2);margin-bottom:4px;">${yr===1?'This Season':`+${yr-1} yr${yr>2?'s':''}`}</div>
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;color:${committed/projCap>0.9?'var(--red2)':committed/projCap>0.75?'var(--gold)':'var(--ice)'};">$${committed.toFixed(1)}M</div>
          <div style="font-size:11px;color:var(--text2);">${pct}% of ~$${projCap}M</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;

  // ---- Retained Salary Obligations ----
  const retained = state.myTeam.retainedContracts || [];
  if(retained.length){
    const retainedTotal = retained.reduce((s,r) => s + (r.amt||0), 0);
    html += `<div style="margin-top:20px;background:rgba(243,156,18,0.05);border:1px solid rgba(243,156,18,0.25);border-radius:8px;padding:16px;">
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">
        💰 Retained Salary Obligations
      </div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:12px;">
        Salary you agreed to eat on traded-away players. These amounts still count against your cap each year until the contract expires.
      </div>
      <div style="overflow-x:auto;">
      <table width="100%" style="border-collapse:collapse;">
        <thead><tr>
          <th style="${thS}">Player</th>
          <th style="${thS}">Eaten/Yr</th>
          <th style="${thS}">Yrs Left</th>
          <th style="${thS}">Total Remaining</th>
          <th style="${thS}">Cap %</th>
        </tr></thead>
        <tbody>
          ${retained.map(r => {
            const capPct = salaryToCapPct(r.amt||0);
            const total = Math.round((r.amt||0) * (r.years||1) * 100) / 100;
            return `<tr>
              <td style="${tdS}font-weight:500;color:var(--gold);">${r.name} <span style="font-size:11px;color:var(--text2);font-weight:400;">(traded away)</span></td>
              <td style="${tdS}font-weight:700;color:var(--gold);">$${(r.amt||0).toFixed(2)}M</td>
              <td style="${tdS}color:${(r.years||1)===1?'var(--red2)':'var(--text2)'};">${r.years||1} yr${(r.years||1)!==1?'s':''}</td>
              <td style="${tdS}color:var(--text2);">$${total.toFixed(2)}M</td>
              <td style="${tdS}color:var(--text2);">${capPct.toFixed(2)}%</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(243,156,18,0.2);display:flex;justify-content:space-between;font-size:13px;">
        <span style="color:var(--text2);">Total retained cap hit this season</span>
        <span style="font-weight:700;color:var(--gold);">$${retainedTotal.toFixed(2)}M / yr</span>
      </div>
    </div>`;
  }

  el.innerHTML = html;
}

// ---- tabs ----
// Which nav group each tab belongs to
function showNavGroup(group){
  document.querySelectorAll('.nav-group-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.nav-submenu').forEach(s=>s.classList.remove('active'));
  const btn = document.getElementById('navg-'+group);
  const sub = document.getElementById('sub-'+group);
  if(btn) btn.classList.add('active');
  if(sub) sub.classList.add('active');
}

function showTab(name){ if(!gameStarted) return;
  const group = TAB_GROUP[name] || 'team';
  showNavGroup(group);
  document.querySelectorAll('.nav-sub-btn').forEach(b=>b.classList.remove('active'));
  const subBtn = document.getElementById('subbtn-'+name);
  if(subBtn) subBtn.classList.add('active');
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  const panelEl = document.getElementById('panel-'+name);
  if(!panelEl) return;
  panelEl.classList.add('active');
  if(name==='trade') renderTradePanel();
  if(name==='playoffs') renderPlayoffs();
  if(name==='resign') renderResign();
  if(name==='draft') renderDraft();
  if(name==='affiliates') renderAffiliates();
  if(name==='lines') renderLines();
  if(name==='calendar'){
    if(state && state.calendar){
      state.calendar.viewMonth = state.calendar.currentMonth || 0;
      state.calendar.viewYear = state.calendar.currentMonth >= 3 ? (state.calendar.year + 1) : state.calendar.year;
    }
    renderCalendar();
  }
  if(name==='contracts') renderContracts();
  if(name==='leaders') renderLeaders();
  if(name==='waivers') renderWaivers();
}

// ================================================================
// MULTI-SLOT SAVE SYSTEM
// Saves stored as hockeyGMSave_<id> in localStorage.
// Index stored at hockeyGMSaveIndex: [ { id, team, season, week, phase, record, savedAt } ]
// ================================================================

const SAVE_PREFIX = 'hockeyGMSave_';
const SAVE_INDEX_KEY = 'hockeyGMSaveIndex';

// The slot id of the currently loaded save (null = unsaved new game)
let currentSaveId = null;

function getSaveIndex(){
  try { return JSON.parse(localStorage.getItem(SAVE_INDEX_KEY)) || []; }
  catch(e){ return []; }
}

function writeSaveIndex(index){
  localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify(index));
}

function buildSaveMeta(id){
  return {
    id,
    team:    state.myTeam?.name || '—',
    season:  state.season || 1,
    week:    state.calendar?.week || state.week || 1,
    phase:   state.calendar?.phase || 'Regular Season',
    record:  state.myTeam ? `${state.myTeam.w||0}-${state.myTeam.l||0}-${state.myTeam.otl||0}` : '0-0-0',
    savedAt: new Date().toISOString(),
  };
}

function saveGame(slotId){
  try {
    const id = slotId || currentSaveId || ('save_' + Date.now());
    state._divisions = JSON.parse(JSON.stringify(DIVISIONS));
    state._teamNames  = [...TEAM_NAMES];
    state._savedAt    = new Date().toISOString();
    state._saveId     = id;
    localStorage.setItem(SAVE_PREFIX + id, JSON.stringify(state));

    // Update index
    const index = getSaveIndex();
    const existing = index.findIndex(s => s.id === id);
    const meta = buildSaveMeta(id);
    if(existing >= 0) index[existing] = meta;
    else index.unshift(meta); // newest first
    writeSaveIndex(index);

    currentSaveId = id;
    showFlash('Saved!', `${meta.team} · Season ${meta.season}`, 'win');
    renderSettingsSaveInfo();
    console.log('[Save] Saved to slot:', id);
  } catch(e){ console.error('[Save] Failed:', e); showFlash('Save Failed', 'Storage may be full.', 'otl'); }
}

function loadGameById(id){
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + id);
    if(!raw) throw new Error('Save not found: ' + id);
    state = JSON.parse(raw);
    if(state._divisions) Object.assign(DIVISIONS, state._divisions);
    if(state._teamNames){ TEAM_NAMES.length = 0; TEAM_NAMES.push(...state._teamNames); }
    currentSaveId = id;
    gameStarted = true;
    renderAll();
    const menu = document.getElementById('screen-menu');
    if(menu){ menu.classList.remove('active'); menu.style.display = 'none'; }
    const teamsel = document.getElementById('screen-teamsel');
    if(teamsel){ teamsel.classList.remove('active'); teamsel.style.display = ''; }
    document.getElementById('app').style.display = 'block';
    if(state.myTeam && state.myTeam.name) loadAndApplyLogo(state.myTeam.name);
    showNavGroup('team');
    showTab('roster');
    closeModal('modal-save-slot');
    showFlash('Welcome Back!', `${state.myTeam?.name || ''} · Season ${state.season}`, 'win');
  } catch(e){ console.error('[Load] Error:', e); showFlash('Load Failed', 'Save data may be corrupted.', 'otl'); }
}

// Legacy single-slot loader — redirect to new system
function loadGame(){
  // Migrate old single save if present
  const oldSave = localStorage.getItem('hockeyGMSave');
  if(oldSave && getSaveIndex().length === 0){
    try {
      const s = JSON.parse(oldSave);
      const id = 'save_migrated';
      s._saveId = id;
      localStorage.setItem(SAVE_PREFIX + id, oldSave);
      const index = getSaveIndex();
      index.unshift({
        id, team: s.myTeam?.name||'—', season: s.season||1,
        week: s.calendar?.week||1, phase: s.calendar?.phase||'Regular Season',
        record: s.myTeam?`${s.myTeam.w||0}-${s.myTeam.l||0}-${s.myTeam.otl||0}`:'0-0-0',
        savedAt: s._savedAt || null,
      });
      writeSaveIndex(index);
    } catch(e){}
  }
  openSaveSlotMenu();
}

function deleteSaveById(id){
  if(!confirm('Delete this save? This cannot be undone.')) return;
  localStorage.removeItem(SAVE_PREFIX + id);
  const index = getSaveIndex().filter(s => s.id !== id);
  writeSaveIndex(index);
  if(currentSaveId === id) currentSaveId = null;
  openSaveSlotMenu();
}

function openSaveSlotMenu(mode){
  // mode: 'load' (from main menu) or 'save' (from in-game)
  const isSaveMode = mode === 'save';
  const el = document.getElementById('save-slot-content');
  const index = getSaveIndex();

  let html = '';

  if(isSaveMode && gameStarted){
    // "Save as new" button at the top
    html += `<button class="btn btn-primary" style="width:100%;margin-bottom:14px;text-align:center;"
      onclick="saveGame();renderSaveSlotList('save');">💾 Save as New Slot</button>`;
  }

  if(!index.length){
    html += `<div style="text-align:center;padding:28px 0;color:var(--text2);font-size:14px;">
      No saves found.<br><span style="font-size:12px;margin-top:6px;display:block;">Start a new game and save to create your first slot.</span>
    </div>`;
  } else {
    html += index.map(meta => {
      const when = meta.savedAt ? new Date(meta.savedAt).toLocaleString() : 'Unknown date';
      const isCurrent = meta.id === currentSaveId;
      return `
        <div style="display:flex;align-items:center;gap:10px;background:var(--rink2);border:1px solid ${isCurrent?'var(--accent)':'var(--border)'};border-radius:8px;padding:12px 14px;margin-bottom:8px;">
          <div style="flex:1;min-width:0;">
            <div style="font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${meta.team}${isCurrent?' <span style="font-size:11px;color:var(--accent);font-weight:700;">● CURRENT</span>':''}
            </div>
            <div style="font-size:12px;color:var(--text2);margin-top:2px;">
              Season ${meta.season} · Wk ${meta.week} · ${meta.phase} · ${meta.record}
            </div>
            <div style="font-size:11px;color:var(--text2);margin-top:2px;">Saved: ${when}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
            ${isSaveMode && isCurrent
              ? `<button class="btn btn-primary" style="font-size:12px;padding:5px 12px;" onclick="saveGame('${meta.id}');renderSaveSlotList('save');">Overwrite</button>`
              : `<button class="btn btn-primary" style="font-size:12px;padding:5px 12px;" onclick="loadGameById('${meta.id}')">Load</button>`
            }
            <button class="btn" style="font-size:12px;padding:5px 12px;color:var(--red2);" onclick="deleteSaveById('${meta.id}')">Delete</button>
          </div>
        </div>`;
    }).join('');
  }

  el.innerHTML = html;
  el.dataset.mode = mode || 'load';
  document.getElementById('modal-save-slot').classList.add('open');
}

function renderSaveSlotList(mode){
  // Re-render just the list content without reopening
  openSaveSlotMenu(mode || document.getElementById('save-slot-content')?.dataset.mode || 'load');
}

function renderSettingsSaveInfo(){
  const el = document.getElementById('settings-save-info');
  if(!el) return;
  const index = getSaveIndex();
  if(!index.length){ el.textContent = 'No saves yet.'; return; }
  const cur = currentSaveId ? index.find(s => s.id === currentSaveId) : index[0];
  if(!cur){ el.textContent = 'No saves yet.'; return; }
  const when = cur.savedAt ? new Date(cur.savedAt).toLocaleString() : 'Unknown';
  el.innerHTML = `<strong style="color:var(--text);">${cur.team}</strong> · Season ${cur.season} · Wk ${cur.week} · ${cur.record} <span style="margin-left:8px;font-size:11px;">Last saved: ${when}</span>`;
}

function confirmLoadFromSettings(){
  if(gameStarted && !confirm('Load a save? Any unsaved progress will be lost.')) return;
  closeModal('modal-settings');
  openSaveSlotMenu('load');
}

// 1. Navigation for Player Cards
function openPlayerPage(id){
  playerPageId = id;
  playerPageTab = 'overview';
  const modal = document.getElementById('player-page');
  if(modal) modal.style.display = 'flex';
  renderPlayerPage();
}

function closePlayerPage(){
  const modal = document.getElementById('player-page');
  if(modal) modal.style.display = 'none';
  playerPageId = null;
}

// 2. Navigation & UI
function showMenu(){
  document.querySelectorAll('.tab-panel, #screen-teamsel').forEach(el => el.classList.remove('active'));
  document.getElementById('app').style.display = 'none';
  const menu = document.getElementById('screen-menu');
  if(menu) {
    menu.classList.add('active');
    menu.style.display = '';
  }
}

function loadGame(){
  try {
    const saved = localStorage.getItem('hockeyGMSave');
    if(!saved) {
      showFlash('No Save Found', 'Start a new game first!', 'otl');
      return;
    }
    state = JSON.parse(saved);
    // Restore league structure that lives outside of state
    if(state._divisions) Object.assign(DIVISIONS, state._divisions);
    if(state._teamNames)  TEAM_NAMES.length = 0, TEAM_NAMES.push(...state._teamNames);
    gameStarted = true;
    renderAll();
    // Properly hide menu screens and reveal the app
    const menu = document.getElementById('screen-menu');
    if(menu){ menu.classList.remove('active'); menu.style.display = 'none'; }
    const teamsel = document.getElementById('screen-teamsel');
    if(teamsel){ teamsel.classList.remove('active'); teamsel.style.display = ''; }
    document.getElementById('app').style.display = 'block';
    // Set watermark initials from loaded state
    const loadedInitials = (state.myTeam && state.myTeam.name || '').split(' ').map(w=>w[0]).join('').slice(0,3);
    const gameLogo = document.getElementById('game-logo-text');
    if(gameLogo && loadedInitials) gameLogo.textContent = loadedInitials;
    if(state.myTeam && state.myTeam.name) loadAndApplyLogo(state.myTeam.name);
    showNavGroup('team');
    showTab('roster');
    showFlash('Welcome Back!', 'Game loaded successfully.', 'win');
  } catch(e){ console.error('[loadGame] Error:', e); showFlash('Load Failed', 'Save data may be corrupted.', 'otl'); }
}

// Add this so your Settings button works!
function showSettings() {
  const modal = document.getElementById('modal-settings');
  if (modal) {
    modal.classList.add('open');
    renderOvrTierEditor();
    renderSettingsSaveInfo();
    if (typeof syncThemeColorPickers === 'function') syncThemeColorPickers();
  }
}

// ================================================================
// WAIVER SYSTEM
// NHL-accurate: players need to clear waivers before minor demotion
// unless they are waiver-exempt (young/inexperienced).
// ================================================================

// How many NHL games a player must have played to lose waiver exemption
// Skaters lose exemption after 30 NHL GP (≈ 1/3 of a season on the roster).
// Goalies after 20 GP. Age cap: only players under 25 with limited experience are exempt.
const WAIVER_EXEMPT_SKATER_GP  = 30;
const WAIVER_EXEMPT_GOALIE_GP  = 20;
const WAIVER_EXEMPT_MAX_AGE    = 25; // Under this age AND below GP threshold = exempt
const WAIVER_CLEAR_DAYS        = 1;  // Clears after 1 sim day (24 hours)

/** True if player can be sent down without going through waivers */
function isWaiverExempt(p){
  if(!p) return true;
  // ELC players who are young and haven't accumulated enough NHL games
  const nhlGP = p.nhlGamesPlayed || 0;
  const gpThreshold = p.pos === 'G' ? WAIVER_EXEMPT_GOALIE_GP : WAIVER_EXEMPT_SKATER_GP;
  if(p.age < WAIVER_EXEMPT_MAX_AGE && nhlGP < gpThreshold) return true;
  if(p.isELC && nhlGP < gpThreshold) return true;
  return false;
}

/** Check if a player from my team is currently on waivers */
function isOnWaivers(playerId){
  if(!state.waivers) return false;
  return state.waivers.some(w => w.player.id === playerId && !w.claimedBy && !w.cleared);
}

/**
 * Place a player on waivers. If waiver-exempt, immediately sends to minors.
 * Otherwise starts a 1-week waiver window; CPU teams may claim.
 */
function placeOnWaivers(playerId, targetLeague){
  if(!state.waivers) state.waivers = [];
  const idx = state.myTeam.roster.findIndex(p => p.id === playerId);
  if(idx === -1){ alert('Player not found on NHL roster.'); return; }
  const p = state.myTeam.roster[idx];

  // Check NMC/M-NMC
  const minorsCheck = canSendToMinors(p);
  if(!minorsCheck.allowed){ alert(minorsCheck.reason); return; }

  // Already on waivers?
  if(isOnWaivers(playerId)){ alert(`${p.name} is already on waivers.`); return; }

  // Waiver-exempt → send directly
  if(isWaiverExempt(p)){
    if(targetLeague === 'echl'){
      sendToECHL(playerId);
    } else {
      sendToAHL(playerId);
    }
    state.log.push(`📋 ${p.name} is waiver-exempt — assigned directly to ${targetLeague === 'echl' ? 'ECHL' : 'AHL'}.`);
    renderAll();
    renderAffiliates();
    return;
  }

  // Place on waivers
  const cal = state.calendar;
  const entry = {
    player: p,
    fromTeam: state.myTeam,
    fromTeamName: state.myTeam.name,
    placedDay: cal ? calSeasonDay(cal) : (state.week || 1) * 7,
    targetLeague: targetLeague || 'ahl',
    claimedBy: null,
    cleared: false
  };
  state.waivers.push(entry);
  // Remove from active NHL roster while on waivers (held in limbo)
  state.myTeam.roster.splice(idx, 1);
  p._onWaivers = true;
  state.log.push(`📋 ${p.name} (${p.ovr} OVR, $${p.salary.toFixed(2)}M) placed on waivers.`);
  showFlash('Waivers', `${p.name} placed on waivers — other teams have 1 week to claim.`, 'otl');
  renderAll();
  renderWaivers();
}

/**
 * Process waivers at end of each simWeek tick.
 * CPU teams in reverse standings order get to claim.
 */
function processWaivers(){
  if(!state.waivers || state.waivers.length === 0) return;
  const cal = state.calendar;
  const currentDay = cal ? calSeasonDay(cal) : (state.week || 1) * 7;

  // Sort CPU teams by reverse standings (worst record first = first priority)
  const cpuTeams = [...state.others].sort((a, b) => {
    const ptA = (a.w||0)*2 + (a.otl||0);
    const ptB = (b.w||0)*2 + (b.otl||0);
    return ptA - ptB; // ascending = worst team first
  });

  state.waivers.forEach(entry => {
    if(entry.claimedBy || entry.cleared) return;
    // Only process if enough time has passed (1 day)
    const placedOn = entry.placedDay != null ? entry.placedDay : (entry.placedWeek != null ? entry.placedWeek * 7 : 0);
    if(currentDay < placedOn + WAIVER_CLEAR_DAYS) return;

    const p = entry.player;
    let claimed = false;

    // Each CPU team evaluates the claim in priority order
    for(const team of cpuTeams){
      if(team.name === entry.fromTeamName) continue; // can't reclaim own player

      // Cap check — can they afford it?
      const teamCap = teamPayroll(team);
      const capRoom = league.salaryCap - teamCap;
      if(p.salary > capRoom + 0.5) continue; // not enough room (with small buffer)

      // Roster size check
      if(team.roster.length >= 23) continue;

      // Evaluate: does this player meaningfully upgrade their roster?
      const positionGroup = team.roster.filter(x => x.pos === p.pos);
      const weakest = positionGroup.length > 0
        ? Math.min(...positionGroup.map(x => x.ovr))
        : 0;

      // Claim if player is noticeably better than weakest at that position
      // (CPU is more eager if they're a worse team)
      const teamPts = (team.w||0)*2 + (team.otl||0);
      const claimThreshold = teamPts < 40 ? 3 : 6; // bad teams claim more aggressively
      if(p.ovr > weakest + claimThreshold || positionGroup.length < 2){
        // CLAIM
        claimed = true;
        entry.claimedBy = team.name;
        p._onWaivers = false;
        snapshotMidSeasonStats(p, entry.fromTeamName);
        team.roster.push(p);
        state.log.push(`🚨 WAIVER CLAIM: ${team.name} claimed ${p.name} (${p.ovr} OVR, $${p.salary.toFixed(2)}M) off waivers!`);
        showFlash('Waiver Claim!', `${team.name} claimed ${p.name} off waivers.`, 'loss');
        // Stop auto-sim if this was the user's player
        if(entry.fromTeamName === state.myTeam.name){
          autoSimCheckWaiverClaim(p.name, team.name);
        }
        break;
      }
    }

    // Unclaimed — assign to target minor league
    if(!claimed){
      entry.cleared = true;
      p._onWaivers = false;
      const { AHL_MIN, AHL_MAX, ECHL_MAX } = AFFILIATE_TIERS;

      if(entry.isCpuOriginated){
        // Return to originating CPU team's affiliate
        const origTeam = entry.fromTeam;
        if(!origTeam.cpuAHL)  origTeam.cpuAHL  = { roster: [] };
        if(!origTeam.cpuECHL) origTeam.cpuECHL = { roster: [] };
        if(p.ovr >= AHL_MIN && origTeam.cpuAHL.roster.length < 15){
          p._affiliate = 'cpuAHL';
          origTeam.cpuAHL.roster.push(p);
        } else {
          p._affiliate = 'cpuECHL';
          origTeam.cpuECHL.roster.push(p);
        }
        state.log.push(`✅ ${p.name} cleared waivers — returned to ${origTeam.name} minors.`);
      } else if(entry.targetLeague === 'echl'){
        // My player going to ECHL
        if(state.echl.roster.length < ECHL_MAX){
          p._affiliate = 'echl';
          if(p.isTwoWay && p.minorSalary != null){
            p.nhlSalary = p.salary;
            p.salary = p.minorSalary;
            p.capPct = salaryToCapPct(p.minorSalary);
          }
          state.echl.roster.push(p);
          state.log.push(`✅ ${p.name} cleared waivers — assigned to ECHL.`);
        } else {
          p._affiliate = 'ahl';
          if(p.isTwoWay && p.minorSalary != null){
            p.nhlSalary = p.salary;
            p.salary = p.minorSalary;
            p.capPct = salaryToCapPct(p.minorSalary);
          }
          state.ahl.roster.push(p);
          state.log.push(`✅ ${p.name} cleared waivers — ECHL full, assigned to AHL.`);
        }
      } else {
        // My player going to AHL
        if(state.ahl.roster.length < AHL_MAX){
          p._affiliate = 'ahl';
          if(p.isTwoWay && p.minorSalary != null){
            p.nhlSalary = p.salary;
            p.salary = p.minorSalary;
            p.capPct = salaryToCapPct(p.minorSalary);
          }
          state.ahl.roster.push(p);
          state.log.push(`✅ ${p.name} cleared waivers — assigned to AHL.`);
          showFlash('Waivers Cleared', `${p.name} cleared waivers and is now in the AHL.`, 'win');
        } else {
          p._affiliate = 'echl';
          if(p.isTwoWay && p.minorSalary != null){
            p.nhlSalary = p.salary;
            p.salary = p.minorSalary;
            p.capPct = salaryToCapPct(p.minorSalary);
          }
          state.echl.roster.push(p);
          state.log.push(`✅ ${p.name} cleared waivers — AHL full, assigned to ECHL.`);
          showFlash('Waivers Cleared', `${p.name} cleared waivers — AHL full, sent to ECHL.`, 'win');
        }
      }
      autoSetLines();
    }
  });

  // Clean up fully resolved entries (keep last 10 for history display)
  const resolved = state.waivers.filter(w => w.claimedBy || w.cleared);
  const pending  = state.waivers.filter(w => !w.claimedBy && !w.cleared);
  state.waivers = [...pending, ...resolved.slice(-10)];
  renderAll();
  renderAffiliates();
  if(document.getElementById('panel-waivers') &&
     document.getElementById('panel-waivers').classList.contains('active')){
    renderWaivers();
  }
}

/** Player can also claim a player currently on waivers from a CPU team */
function claimFromWaivers(entryIdx){
  if(!state.waivers) return;
  const entry = state.waivers[entryIdx];
  if(!entry || entry.claimedBy || entry.cleared){
    alert('This player is no longer available.'); renderWaivers(); return;
  }
  const p = entry.player;

  // Cap check
  const capRoom = league.salaryCap - capUsed();
  if(p.salary > capRoom + 0.01){
    alert(`Not enough cap space to claim ${p.name} ($${p.salary.toFixed(2)}M needed, $${Math.max(0, capRoom).toFixed(2)}M available).`);
    return;
  }
  // Roster check
  if(state.myTeam.roster.length >= 23){
    alert('NHL roster is full (23 players). Make room before claiming.');
    return;
  }

  if(!confirm(`Claim ${p.name} (${p.ovr} OVR, $${p.salary.toFixed(2)}M/yr, ${p.years} yr${p.years!==1?'s':''} left)?\n\nYou will take on their full contract. The original team loses the player.`)){
    return;
  }

  entry.claimedBy = state.myTeam.name;
  p._onWaivers = false;
  snapshotMidSeasonStats(p, entry.fromTeamName);
  state.myTeam.roster.push(p);
  autoSetLines();
  state.log.push(`🏒 You claimed ${p.name} (${p.ovr} OVR) off waivers from ${entry.fromTeamName}!`);
  showFlash('Waiver Claim!', `${p.name} added to your roster.`, 'win');
  renderAll();
  renderWaivers();
}

/**
 * CPU team places a player on waivers (called from cpuManageRosters).
 * The player must already be removed from team.roster before calling.
 * Returns true if placed on waivers, false if exempt (caller should handle directly).
 */
function cpuPlaceOnWaivers(team, player){
  if(!state.waivers) state.waivers = [];
  // Waiver-exempt players skip the wire — route directly to minors
  if(isWaiverExempt(player)){
    const { AHL_MIN } = AFFILIATE_TIERS;
    if(!team.cpuAHL)  team.cpuAHL  = { roster: [] };
    if(!team.cpuECHL) team.cpuECHL = { roster: [] };
    if(player.ovr >= AHL_MIN){
      player._affiliate = 'cpuAHL';
      team.cpuAHL.roster.push(player);
    } else {
      player._affiliate = 'cpuECHL';
      team.cpuECHL.roster.push(player);
    }
    return false;
  }
  player._onWaivers = true;
  const cal = state.calendar;
  state.waivers.push({
    player,
    fromTeam: team,
    fromTeamName: team.name,
    placedDay: cal ? calSeasonDay(cal) : (state.week || 1) * 7,
    targetLeague: 'ahl',
    claimedBy: null,
    cleared: false,
    isCpuOriginated: true
  });
  state.log.push(`📋 ${team.name} placed ${player.name} (${player.ovr} OVR) on waivers.`);
  return true;
}

/** Render the Waivers tab panel */
function renderWaivers(){
  const el = document.getElementById('waivers-body');
  if(!el || !gameStarted) return;
  if(!state.waivers) state.waivers = [];

  const pending   = state.waivers.filter(w => !w.claimedBy && !w.cleared);
  const recent    = state.waivers.filter(w =>  w.claimedBy || w.cleared).slice(-8).reverse();
  const cal = state.calendar;
  const currentDay = cal ? calSeasonDay(cal) : (state.week || 1) * 7;

  // ── My players I can put on waivers ──────────────────────────────
  const sendDownCandidates = getDemotionCandidates(state.myTeam.roster)
    .filter(p => !isOnWaivers(p.id));

  let html = `
  <div style="margin-bottom:24px;">
    <h3 style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;margin-bottom:6px;letter-spacing:0.5px;">WAIVER WIRE</h3>
    <p style="font-size:13px;color:var(--text2);margin-bottom:16px;">
      Non-exempt players must clear waivers before being sent to the minors. Other teams have <strong>24 hours</strong> (1 sim day) to claim.
      Claims are processed in reverse standings order — worst team gets first pick.
    </p>
  </div>

  <!-- ACTIVE WAIVERS -->
  <div class="affiliate-section" style="margin-bottom:20px;">
    <div class="affiliate-header" style="margin-bottom:10px;">Active Waivers <span style="font-size:13px;font-weight:400;color:var(--text2);margin-left:8px;">${pending.length} player${pending.length!==1?'s':''} currently on waivers</span></div>`;

  if(pending.length === 0){
    html += `<p style="font-size:13px;color:var(--text2);padding:12px 0;">No players currently on waivers.</p>`;
  } else {
    html += `<table width="100%" style="border-collapse:collapse;font-size:13px;">
      <thead><tr>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Player</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Pos</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">OVR</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Age</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Salary</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Yrs</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">From</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Clears</th>
        <th style="padding:6px 8px;border-bottom:1px solid var(--border);"></th>
      </tr></thead><tbody>`;

    pending.forEach((entry, i) => {
      const p = entry.player;
      const placedOn = entry.placedDay != null ? entry.placedDay : (entry.placedWeek != null ? entry.placedWeek * 7 : 0);
      const daysLeft = Math.max(0, (placedOn + WAIVER_CLEAR_DAYS) - currentDay);
      const isMyPlayer = entry.fromTeamName === state.myTeam.name;
      const capRoom = league.salaryCap - capUsed();
      const canClaim = !isMyPlayer && p.salary <= capRoom + 0.01 && state.myTeam.roster.length < 23;
      const globalIdx = state.waivers.indexOf(entry);
      html += `<tr>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);font-weight:600;">${p.name}${isMyPlayer?'<span style="font-size:10px;color:var(--text2);margin-left:6px;">(yours)</span>':''}</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);"><span class="pos-badge">${p.pos}</span></td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">${ovrCell(p.ovr)}</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">${p.age}</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">$${p.salary.toFixed(2)}M</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">${p.years}</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);color:var(--text2);">${entry.fromTeamName}</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">${daysLeft === 0 ? '<span style="color:var(--gold);">Next sim</span>' : `${daysLeft}d`}</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">
          ${canClaim ? `<button class="btn btn-xs" style="background:rgba(41,128,185,0.2);border-color:var(--accent);" onclick="claimFromWaivers(${globalIdx})">🏒 Claim</button>` : ''}
          ${isMyPlayer ? `<span style="font-size:11px;color:var(--text2);">Awaiting clearance</span>` : ''}
        </td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }
  html += `</div>`;

  // ── Send Down (waiver required) ───────────────────────────────────
  html += `<div class="affiliate-section" style="margin-bottom:20px;">
    <div class="affiliate-header" style="margin-bottom:6px;">Send Down — Place on Waivers</div>
    <p style="font-size:13px;color:var(--text2);margin-bottom:12px;">
      Non-exempt players go through waivers first. 
      <span style="color:var(--gold);">⭐ Exempt</span> players skip waivers (young / low NHL games played).
    </p>`;

  if(sendDownCandidates.length === 0){
    html += `<p style="font-size:13px;color:var(--text2);padding:8px 0;">No demotable players on your NHL roster.</p>`;
  } else {
    html += `<table width="100%" style="border-collapse:collapse;font-size:13px;">
      <thead><tr>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Player</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Pos</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">OVR</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Age</th>
        <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--text2);border-bottom:1px solid var(--border);">Status</th>
        <th style="padding:6px 8px;border-bottom:1px solid var(--border);"></th>
      </tr></thead><tbody>`;
    sendDownCandidates.forEach(p => {
      const exempt = isWaiverExempt(p);
      html += `<tr>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);font-weight:500;">${p.name}</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);"><span class="pos-badge">${p.pos}</span></td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">${ovrCell(p.ovr)}</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">${p.age}</td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">
          ${exempt
            ? `<span style="font-size:11px;color:var(--gold);">⭐ Exempt</span>`
            : `<span style="font-size:11px;color:var(--text2);">Waivers required</span>`}
        </td>
        <td style="padding:7px 8px;border-bottom:1px solid rgba(100,160,220,0.07);">
          <button class="btn btn-xs" onclick="placeOnWaivers('${p.id}','ahl')" title="${exempt?'Exempt — direct AHL':'Place on waivers → AHL'}">
            ${exempt ? '↓ AHL' : '📋 Waivers → AHL'}
          </button>
          <button class="btn btn-xs" style="margin-left:4px;" onclick="placeOnWaivers('${p.id}','echl')" title="${exempt?'Exempt — direct ECHL':'Place on waivers → ECHL'}">
            ${exempt ? '↓ ECHL' : '📋 Waivers → ECHL'}
          </button>
        </td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }
  html += `</div>`;

  // ── Recent waiver history ─────────────────────────────────────────
  if(recent.length > 0){
    html += `<div class="affiliate-section">
      <div class="affiliate-header" style="margin-bottom:10px;">Recent Waiver Activity</div>
      <table width="100%" style="border-collapse:collapse;font-size:12px;">
        <thead><tr>
          <th style="text-align:left;padding:5px 8px;color:var(--text2);border-bottom:1px solid var(--border);">Player</th>
          <th style="text-align:left;padding:5px 8px;color:var(--text2);border-bottom:1px solid var(--border);">From</th>
          <th style="text-align:left;padding:5px 8px;color:var(--text2);border-bottom:1px solid var(--border);">Result</th>
        </tr></thead><tbody>`;
    recent.forEach(entry => {
      const p = entry.player;
      const result = entry.claimedBy
        ? `<span style="color:var(--red2);">Claimed by ${entry.claimedBy}</span>`
        : `<span style="color:#2ecc71;">Cleared → ${entry.targetLeague?.toUpperCase()||'AHL'}</span>`;
      html += `<tr>
        <td style="padding:5px 8px;border-bottom:1px solid rgba(100,160,220,0.06);font-weight:500;">${p.name} <span style="color:var(--text2);">${p.ovr} OVR</span></td>
        <td style="padding:5px 8px;border-bottom:1px solid rgba(100,160,220,0.06);color:var(--text2);">${entry.fromTeamName}</td>
        <td style="padding:5px 8px;border-bottom:1px solid rgba(100,160,220,0.06);">${result}</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  }

  // ── Exemption legend ─────────────────────────────────────────────
  html += `<div style="margin-top:20px;padding:12px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:6px;font-size:12px;color:var(--text2);">
    <strong style="color:var(--text);display:block;margin-bottom:6px;">Waiver Exemption Rules</strong>
    Skaters are waiver-exempt until they've played <strong style="color:var(--text);">${WAIVER_EXEMPT_SKATER_GP} NHL games</strong> 
    or turn <strong style="color:var(--text);">25</strong> (whichever comes first). 
    Goalies are exempt until <strong style="color:var(--text);">${WAIVER_EXEMPT_GOALIE_GP} NHL games</strong>. 
    ELC players who are still developing are also typically exempt.
    Once a player loses exemption, they must clear waivers before any minor-league assignment.
  </div>`;

  el.innerHTML = html;
}

// ── Hook waivers processing into simWeek ─────────────────────────
// Track NHL games played each week for waiver exemption tracking
function trackNhlGamesPlayed(gamesPlayed = 1){
  if(!state || !state.myTeam) return;
  // Track for the human team
  state.myTeam.roster.forEach(p => {
    if(!p.nhlGamesPlayed) p.nhlGamesPlayed = 0;
    p.nhlGamesPlayed += gamesPlayed;
  });
  // Track for all CPU teams so waiver exemption is accurate league-wide
  if(state.others) state.others.forEach(team => {
    (team.roster || []).forEach(p => {
      if(!p.nhlGamesPlayed) p.nhlGamesPlayed = 0;
      p.nhlGamesPlayed += gamesPlayed;
    });
  });
}


// ================================================================
// TEAM LOGO — INITIALS CREST (no API, works everywhere)
// ================================================================

// Deterministic color palette picker based on team name
const LOGO_PALETTES = [
  { bg: '#1a3a6b', accent: '#c9a84c', ring: '#e8c96d' }, // navy / gold
  { bg: '#8b0000', accent: '#c0c0c0', ring: '#e0e0e0' }, // red / silver
  { bg: '#1a5c1a', accent: '#f5d020', ring: '#ffe44d' }, // green / yellow
  { bg: '#2c1a6b', accent: '#7ec8e3', ring: '#a8ddf0' }, // purple / ice blue
  { bg: '#0a3d5c', accent: '#e84c3c', ring: '#ff6b5b' }, // dark blue / red
  { bg: '#4a1a00', accent: '#f39c12', ring: '#f5b942' }, // brown / orange
  { bg: '#1a1a2e', accent: '#00d4aa', ring: '#33e8c0' }, // black / teal
  { bg: '#5c1a3a', accent: '#e0e0e0', ring: '#ffffff' }, // maroon / white
];

function hashTeamName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getTeamInitials(teamName) {
  const words = teamName.trim().split(/\s+/);
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
  // Use first letter of each word, max 2 chars (skip small words like "of", "the")
  const significant = words.filter(w => w.length > 2);
  if (significant.length >= 2) return (significant[0][0] + significant[significant.length - 1][0]).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function generateTeamLogo(teamName) {
  const palette = LOGO_PALETTES[hashTeamName(teamName) % LOGO_PALETTES.length];
  const initials = getTeamInitials(teamName);
  const fontSize = initials.length === 1 ? 72 : 58;

  // Shield crest path
  const svg = `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
    <!-- Shield shape -->
    <path d="M100 12 L178 40 L178 110 Q178 160 100 192 Q22 160 22 110 L22 40 Z"
          fill="${palette.bg}" stroke="${palette.ring}" stroke-width="4"/>
    <!-- Inner shield border -->
    <path d="M100 24 L166 48 L166 112 Q166 154 100 182 Q34 154 34 112 L34 48 Z"
          fill="none" stroke="${palette.accent}" stroke-width="2" opacity="0.6"/>
    <!-- Initials -->
    <text x="100" y="118" 
          font-family="'Barlow Condensed', Arial Narrow, sans-serif"
          font-weight="800" font-size="${fontSize}"
          fill="${palette.accent}"
          text-anchor="middle" dominant-baseline="middle"
          letter-spacing="2">
      ${initials}
    </text>
    <!-- Bottom accent bar -->
    <path d="M60 158 Q100 168 140 158" stroke="${palette.accent}" stroke-width="3" fill="none" opacity="0.7"/>
  </svg>`;

  return svg;
}

function applyLogo(teamName, svg) {
  if (!svg) return;
  // Header logo
  const hdrLogo = document.getElementById('hdr-logo');
  if (hdrLogo) {
    hdrLogo.innerHTML = svg;
    hdrLogo.style.background = 'none';
    hdrLogo.style.boxShadow = 'none';
    hdrLogo.style.padding = '0';
    hdrLogo.style.width = '48px';
    hdrLogo.style.height = '48px';
    const s = hdrLogo.querySelector('svg');
    if (s) { s.style.width = '100%'; s.style.height = '100%'; }
  }
  // Watermark
  const watermark = document.getElementById('game-logo-text');
  if (watermark) {
    watermark.innerHTML = svg;
    watermark.style.fontSize = '';
    watermark.style.color = '';
    watermark.style.letterSpacing = '';
    watermark.style.width = '500px';
    watermark.style.height = '500px';
    watermark.style.opacity = '0.06';
    const s = watermark.querySelector('svg');
    if (s) { s.style.width = '100%'; s.style.height = '100%'; }
  }
  // Team select watermark
  const selLogo = document.getElementById('teamsel-logo-text');
  if (selLogo && selLogo.closest('#player-page') === null) {
    selLogo.innerHTML = svg;
    selLogo.style.fontSize = '';
    selLogo.style.color = '';
    selLogo.style.letterSpacing = '';
    selLogo.style.width = '340px';
    selLogo.style.height = '340px';
    selLogo.style.opacity = '0.12';
    const s = selLogo.querySelector('svg');
    if (s) { s.style.width = '100%'; s.style.height = '100%'; }
  }
}

function loadAndApplyLogo(teamName) {
  const svg = generateTeamLogo(teamName);
  applyLogo(teamName, svg);
}

window.onload = () => {
  // 1. Visuals & Themes
  loadThemeFromStorage();
  applyOvrTierCSS();      // Paints the player colors (Elite, Star, etc.)
  
  // 2. Settings & Logic
  renderOvrTierEditor();  // Prepares the OVR Editor in the settings menu
  bindThemeColorEditor(); // Prepares the UI Theme color pickers
  
  try {
    // Load the Goalie Split preference and sync the slider UI
    syncGoalieSplitUI();
  } catch(e) {
    console.error("Failed to load goalie split:", e);
  }

  // 3. Launch
  showMenu(); // Opens the Main Menu
};
