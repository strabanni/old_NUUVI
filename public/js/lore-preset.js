// The FOYAEN × ENTITY lore, ready to load into a story's overview (Overview → Edit → Start from our lore).
export const LORE_PRESET = {
  tagline: 'nobody in this world actually meets by accident.',
  intro: `[center][h]nobody in this world actually meets by **accident**.[/h][/center]

every introduction can be traced not to fate, not to coincidence, but to **proximity**. a friend of a coworker. a cousin's roommate. a sponsor's assistant. a bartender who remembers a face. a stylist who needs a favor. a landlord who knows a **promoter**.

[center]*the cities look enormous from the outside —*
*inside them, they function like small rooms.*[/center]`,
  sections: [
    {
      title: 'ownership',
      body: `because behind the nightlife, internships, shops, studios, and apartments sits something quieter: **ownership**.

restaurants aren't just restaurants. a gallery opening isn't just an event. a job offer isn't just a job. someone **funded** it. someone **manages** it. someone benefits from who **succeeds** and who **fails**.

a pair of conglomerates operate across these networks, buying struggling businesses, backing artists, opening venues, financing projects, and placing people exactly where they're useful. most residents know the companies exist. others depend on them to thrive.`,
    },
    {
      title: 'no one is forced into the cycle',
      body: 'they step into it __willingly__ for a chance at something better, and only realize later that leaving it is much harder than entering.',
    },
    {
      title: 'the main frame of things',
      body: `the world isn't divided by good and bad people.

[center]some people get to **choose**. some people **adapt**. some people get **stuck**.[/center]`,
    },
  ],
  independentNote: 'will they find themselves consumed by those bigger than themselves?',
  // The gossip column: a Lady Whistledown for the group chat era.
  letter: `dearest gentle reader,

it has come to this author's attention that you've arrived in a city where *everyone* knows someone — and someone **always** knows you. the brunch spots are booked, the group chats are on fire, and the guest lists? curated, darling. not one soul here meets by accident, no matter how cute the coincidence looks on their story.

so grab your iced coffee, turn your read receipts **off**, and keep up. this author certainly will.`,
  signoff: 'yours truly, the column ☕︎',
  orgs: [
    {
      name: 'FOYAEN INC.', kind: 'conglomerate', founded: '2019', credit: '© coi',
      motto: 'image curated, stardom crafted: will you be the one?',
      whisper: "FOYAEN signs dreamers on a monday and sells their \"authentic\" breakdown by friday. the contract is pink. the fine print is *not*. 💅",
      body: `a media lifestyle conglomerate built around people rather than products. FOYAEN specializes in turning visibility into profit — developing public figures, manufacturing narratives, and maintaining relevance through exposure.

at *first glance*, FOYAEN represents the new and the fresh, appealing to the ~~unskilled~~, raw and __desperate__ for an opportunity to arise. but when given a *second glance*, those narratives become **reality**, the exposure becomes __suffocating__, and one might have to consider what perspective the public has arose you in to be a well-known figure.`,
    },
    {
      name: 'AUURA', kind: 'subsidiary', parent: 'FOYAEN INC.', motto: 'music label',
      whisper: "AUURA trainees are told to just be themselves. curious, then, that they all have the exact same smile.",
      body: "a music label responsible for producing performers rather than simply artists. AUURA develops idols, soloists, and influencer personalities, overseeing training, branding, promotions, and public image. its talent roster regularly crosses into acting, modeling, and commercial advertising, making it the primary entry point into FOYAEN's ecosystem.",
    },
    {
      name: 'ENTITY DYNAMICS', kind: 'conglomerate', founded: '1964', credit: '© doki',
      motto: 'the act of consumption? a bottomless pit, starving to be.',
      whisper: "ENTITY has outlived three recessions, two scandals and every rival who called them boomers. darling, they don't follow trends. they *acquire* them.",
      body: `an __enterprise__ embedded in the every day lives of people, ENTITY is regarded as ***more*** than just a **household name**: it is the platform many people seek to stand upon.

despite bringing fruition to its name over many *centuries* and its enemies believing "__out with the old__", **ENTITY DYNAMICS** has a *hunger* that shall not be quelled by time. time has only granted the business __wisdom__, and an **insatiable** hunger to consume anything in order to **BE**.`,
    },
    {
      name: 'FLÂNEUR', kind: 'subsidiary', parent: 'ENTITY DYNAMICS', motto: 'liaison',
      whisper: "every handshake between ENTITY and its partners goes through FLÂNEUR first. which begs the question: who's actually holding whose hand?",
      body: 'a parent company housed under ENTITY, responsible for being the "liaison" between ENTITY and its partners.',
    },
    {
      name: 'SERAPHINE PUBLISHING', kind: 'subsidiary', parent: 'ENTITY DYNAMICS', motto: 'publishing house',
      whisper: "if a SERAPHINE scout slides into your DMs, congratulations. your little book is about to become their very big asset.",
      body: 'a publishing house responsible for managing writers and creative work artists. SERAPHINE handles managing creators, content, manufacturing and distributing, and is commonly sighted scouting through social media and the public for new and upcoming authors who are in need of a platform.',
    },
    {
      name: 'INTRÉPIDE (ent.)', kind: 'subsidiary', parent: 'ENTITY DYNAMICS', motto: 'entertainment',
      whisper: "total freedom, minimal interference, pure artistry. or so the press release says. this author has *notes*.",
      body: 'an entertainment company focusing primarily on managing musical acts and production. they commonly house independent artists who have more freedom to pursue their artistry with minimal interference.',
    },
    {
      name: 'CATCHYE', kind: 'independent', motto: 'luxury fashion house',
      whisper: "it was never about the dress, sweetie. it's about who got photographed in it, and who very much did not get the invite.",
      body: "a luxury fashion house focused on image rather than volume. CATCHYE produces seasonal collections, red-carpet styling, and private client wardrobes. its garments appear frequently in high-profile events and editorial shoots, and the brand's value comes from association — **who** wears it matters more than how much it sells.",
    },
    {
      name: 'BLOOM HAUS', kind: 'independent', motto: 'gardens, florals & events',
      whisper: "a third office, more greenhouses than anyone can explain, and every wedding worth crashing. who knew flowers paid *this* well? 🌷",
      body: "a multi-purpose company focusing on gardenia landscaping, floral boutiques, and wedding / large scale event planning. recently opened its third office location, with a few flower shops and many more warehouses / greenhouses dedicated to fulfilling its own requests and the requests of other businesses.",
    },
    {
      name: 'DRÖWNER', kind: 'independent', motto: 'celebrity journalism',
      whisper: "this author would never stoop to DRÖWNER's level. they print rumors. this author prints **receipts**, with better timing.",
      body: 'a celebrity journalism and culture publication combining gossip reporting, industry news, and editorial commentary. DRÖWNER releases articles, photo leaks, relationship rumors, and public investigations involving entertainers and public figures. widely read and rarely cooperative, it is considered both a **promotional catalyst** and a **reputational threat** within entertainment circles.',
    },
  ],
};
