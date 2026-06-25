// ================================================================
// DIMINUTIVES — Mapping prénoms → diminutifs (FR + EN)
// Alex → [alexandre, alexandra, alexis, alexander]
// Alexandre → [alex, xan]
// ================================================================

// Map prénom "forme officielle" → diminutifs courants
const DIMINUTIVES_FR = {
    alexandre: ['alex', 'xan'],
    alexandra: ['alex', 'sasha'],
    antoine: ['anto', 'tony'],
    benjamin: ['ben', 'benji'],
    catherine: ['cathy', 'kate', 'cath'],
    christian: ['chris'],
    christine: ['chris', 'christy'],
    christophe: ['chris'],
    daniel: ['dan', 'danny'],
    david: ['dav', 'dave'],
    dominique: ['dom'],
    elisabeth: ['liz', 'beth', 'lisa', 'babeth', 'eli'],
    emmanuel: ['manu'],
    emmanuelle: ['manu'],
    eric: ['rico'],
    francois: ['fran', 'franck', 'francky'],
    francoise: ['fran'],
    frederic: ['fred'],
    frederique: ['fred'],
    gabriel: ['gabi'],
    geraldine: ['gegi', 'geri'],
    guillaume: ['gui', 'will'],
    henri: ['henry', 'riri'],
    jacques: ['jack', 'jacky'],
    jean: ['jeannot', 'jo'],
    'jean-baptiste': ['jb'],
    'jean-christophe': ['jc'],
    'jean-claude': ['jc'],
    'jean-francois': ['jf'],
    'jean-louis': ['jl'],
    'jean-luc': ['jl'],
    'jean-marc': ['jm'],
    'jean-michel': ['jm'],
    'jean-paul': ['jp'],
    'jean-philippe': ['jp'],
    'jean-pierre': ['jp'],
    'jean-yves': ['jy'],
    jerome: ['jerry'],
    josephine: ['jo', 'joy'],
    julien: ['juju', 'jul'],
    laurent: ['lolo', 'lau'],
    laurence: ['lau'],
    louis: ['lou'],
    louise: ['lou'],
    lucas: ['luc'],
    magali: ['maggy'],
    marguerite: ['margot'],
    marianne: ['mary'],
    marie: ['mary'],
    'marie-claire': ['mc'],
    'marie-france': ['mf'],
    'marie-laure': ['ml'],
    'marie-pierre': ['mp'],
    mathieu: ['mat', 'mat'],
    matthieu: ['mat', 'matt'],
    maxime: ['max'],
    michel: ['mic', 'mick'],
    michele: ['mich'],
    nicolas: ['nico'],
    olivier: ['oli', 'ol'],
    patricia: ['pat'],
    patrice: ['pat'],
    patrick: ['pat', 'patou'],
    philippe: ['phil'],
    pierre: ['pierrot'],
    raphael: ['raph'],
    remy: ['rem'],
    robert: ['bob', 'rob'],
    sebastien: ['seb'],
    sophie: ['so'],
    stephane: ['steph', 'stef'],
    stephanie: ['steph', 'stef'],
    suzanne: ['suzy', 'suze'],
    sylvie: ['syl'],
    thierry: ['titi'],
    thomas: ['tom'],
    valentin: ['val'],
    valerie: ['val'],
    veronique: ['vero', 'vro'],
    victor: ['vic'],
    victoire: ['vic'],
    vincent: ['vinz', 'vinc'],
    xavier: ['xav'],
    yves: ['yv'],
    yvette: ['yv'],
};

const DIMINUTIVES_EN = {
    alexander: ['alex', 'xander'],
    andrew: ['andy', 'drew'],
    anthony: ['tony', 'ant'],
    barbara: ['barb', 'babs'],
    benjamin: ['ben', 'benny'],
    catherine: ['cathy', 'cat', 'kate'],
    charles: ['charlie', 'chuck'],
    christopher: ['chris', 'christo'],
    daniel: ['dan', 'danny'],
    david: ['dave', 'davey'],
    deborah: ['deb', 'debbie'],
    edward: ['ed', 'eddie', 'ted'],
    elisabeth: ['liz', 'beth', 'lisa', 'betsy'],
    elizabeth: ['liz', 'beth', 'lisa', 'betsy'],
    frederick: ['fred', 'freddie'],
    geoffrey: ['geoff'],
    george: ['geo'],
    gregory: ['greg'],
    henry: ['hank', 'harry'],
    isabella: ['bella', 'izzy'],
    james: ['jim', 'jimmy', 'jamie'],
    jennifer: ['jen', 'jenny'],
    jeremy: ['jerry'],
    joseph: ['joe', 'joey'],
    josephine: ['jo', 'josie'],
    joshua: ['josh'],
    katherine: ['kate', 'katie', 'kat'],
    kenneth: ['ken', 'kenny'],
    lawrence: ['larry', 'lawrie'],
    margaret: ['maggie', 'meg', 'peggy'],
    matthew: ['matt', 'matty'],
    megan: ['meg'],
    michael: ['mike', 'mick'],
    nathaniel: ['nat', 'nate'],
    nicholas: ['nick', 'nicky'],
    patricia: ['pat', 'patty', 'trish'],
    peter: ['pete'],
    philip: ['phil'],
    rebecca: ['becky', 'becca'],
    richard: ['rich', 'dick', 'rick'],
    robert: ['rob', 'bob', 'bobby'],
    samuel: ['sam', 'sammy'],
    stephanie: ['steph'],
    stephen: ['steve', 'stevie'],
    steven: ['steve', 'stevie'],
    susan: ['sue', 'suzy'],
    theodore: ['ted', 'theo', 'teddy'],
    thomas: ['tom', 'tommy'],
    timothy: ['tim', 'timmy'],
    victoria: ['vicky', 'tori'],
    virginia: ['ginny', 'gina'],
    william: ['will', 'bill', 'billy', 'willy'],
    zachary: ['zach', 'zak'],
};

// Index unifié + inverse (alex → [alexandre, alexandra, alexander])
const FORWARD = new Map(); // official → [variants]
const REVERSE = new Map(); // variant → [officials]

function registerMap(map) {
    for (const [official, variants] of Object.entries(map)) {
        if (!FORWARD.has(official)) FORWARD.set(official, new Set());
        for (const v of variants) {
            FORWARD.get(official).add(v);
            if (!REVERSE.has(v)) REVERSE.set(v, new Set());
            REVERSE.get(v).add(official);
        }
    }
}
registerMap(DIMINUTIVES_FR);
registerMap(DIMINUTIVES_EN);

// Retourne toutes les formes candidates d'un prénom (officiel + diminutifs + inverses)
function getNameVariants(firstName) {
    const norm = (firstName || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const set = new Set([norm]);
    if (FORWARD.has(norm)) for (const v of FORWARD.get(norm)) set.add(v);
    if (REVERSE.has(norm)) for (const o of REVERSE.get(norm)) set.add(o);
    // Retirer le vide
    set.delete('');
    return [...set];
}

module.exports = { getNameVariants, DIMINUTIVES_FR, DIMINUTIVES_EN };
