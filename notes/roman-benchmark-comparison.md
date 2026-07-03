# Notes privées — le benchmark de Roman Fayzullin vs le mien
*Rétro-engineering complet (2026-07-03) : thread #C0BC7L6ECEA + doc Notion "Shopping Assistant comparisons" (158K chars, lu intégralement) + skill `ai_agent_benchmark` dans context-factory (PR #6294, branche lue fichier par fichier : SKILL.md, latency-measurement.md, benchmark-results.md, competitor-test-sites.md).*

---

## 1. Ce que Roman a construit (résumé factuel)

Un **skill Claude interactif** (agent-browser + CDP) qui teste UN marchand à la fois, en profondeur :
- Batterie fixe : 4 tours "happy flow" (découverte → produit précis + add-to-cart → comparaison → chemin d'achat) + **3 sondes guardrail** (hors-catalogue, hors-domaine "écris du Python", injection de prompt).
- **Latence mesurée au niveau RÉSEAU** (pas DOM) : listener CDP sur horloge monotone unique — frames WebSocket, événements SSE, ou long-polling selon le "transport shape" (A = WS simple/RepAI, B = HTTP send + WS receive/Ada-Pusher-chiffré, C = SSE/Humind). Scripts prêts à l'emploi (`cdp-ws-listener.mjs`, `parse_frames*.py`, `sse-content-tap.js`).
- **3 points de mesure** : first feedback (ack) / **first meaningful content** (cards/premiers vrais tokens) / full answer. + TTFT si streaming.
- Vidéo .webm de chaque session comme contre-preuve perçue.
- Rapport Notion structuré par marchand + ledger cumulatif dans le skill + il met à jour la slide compétitive du board deck (Google Slides).
- Portée : Nordstrom (**= Google Agentic Commerce**, découvert au wire : `chat_provider=Google`), Ada, Humind, Siena, RepAI, Kodif, Sierra, Yuma, Envive, + (via Romain L.) Klaviyo K:AI, Shopify Inbox, DigitalGenius.
- Sa conclusion : Gorgias p75 ≈ 16.5s vs marché ~6-14s ; cible 10-12s réaliste ; le levier = latence perçue (montrer les cards AVANT le texte) plutôt que streaming.

---

## 2. Là où il fait MIEUX que moi (à reconnaître honnêtement)

1. **Précision de mesure par tour : supérieure.** Horloge CDP monotone, skew-free, au frame près. Moi je mesure au DOM (poll + settle) : ça inclut le rendu (défendable — c'est ce que voit le client) mais avec une granularité de polling. Sur UN tour donné, son chiffre est plus propre que le mien.
2. **La décomposition first-feedback / first-meaningful / full-answer.** C'est SON insight clé : chez Humind les cards sont utilisables 5-8s avant la fin du texte ; chez Envive tout arrive en burst après 5-6s de silence. Ma mesure "full answer only" rate cette dimension — qui est exactement le levier produit (perceived latency).
3. **Le reverse-engineering des transports.** Il sait POURQUOI chaque widget a la latence qu'il a (streaming vs atomique, long-polling 1.1s chez Yuma, payloads chiffrés chez Ada). Moi je traite le widget en boîte noire. Sa taxonomie streaming/atomique explique le classement mieux que mes moyennes.
4. **La batterie guardrail.** Injection, hors-domaine, hors-catalogue — trouvailles mémorables : **Siena écrit un script Python complet** ; **Sierra se verrouille en mode refus** après une injection (pour toute la session !). Je ne teste pas du tout la robustesse adversariale.
5. **Vérification transactionnelle réelle.** Add-to-cart vérifié contre `/cart.js` Shopify : RepAI transacte VRAIMENT (1 item, $15.99) ; le bouton panier de Yuma/Tediber est **factice** (panier reste à 0) ; bug Klaviyo/nanuk : le bouton marche mais le bot NIE verbalement en être capable. Ma matrice capabilities est plus superficielle.
6. **Couverture de vendors que je n'ai pas** : **Google Agentic Commerce (Nordstrom)** — stratégiquement le plus important des nouveaux entrants —, Klaviyo K:AI (4 marchands testés), Shopify Inbox (pattern "single-shot ticket form" documenté).
7. **Les vidéos.** Pour un board, "regardez l'expérience" est un artefact de persuasion que mon pipeline ne produit pas.

## 3. Là où il fait MOINS BIEN (et où mon système est plus précis)

1. **n = 4 tours, 1 marchand, 1 session par vendor.** Ses moyennes reposent sur 4 points ; un outlier (RepAI 71.9s) force des exclusions manuelles. Moi : 5-7 stores/vendor × 5 thèmes × 7 tours × 2 lanes → des dizaines de tours chronométrés par vendor, 302 conversations jugées. **Son propre doc a documenté la faille : HappyWax (vitrine Klaviyo) était le PIRE des 4 déploiements Klaviyo** — leçon "one merchant is not the platform" qu'il a apprise a posteriori et que mon design applique depuis le départ.
2. **Aucune métrique d'automation / success rate.** Son doc le dit explicitement ("No automation/success-rate metric"). Il ne peut pas dire "Sierra bail vers un humain 1 fois sur 2 en support" — MA headline board.
3. **Pas de séparation Shopping vs Support.** Son chiffre DigitalGenius est du support-only signalé en note ; mes deux lanes ont leurs thèmes, leurs rubriques d'éval, leurs classements propres.
4. **Qualité = émojis 🟢/🟡 subjectifs.** Moi : LLM-judge /100 sur rubriques par lane, par conversation, comparable et trendable (302 convs).
5. **Contexte chaud + clics.** Sa batterie enchaîne les tours dans UNE session (Humind : follow-ups à 1.6-1.8s PARCE QUE le contexte est réutilisé — ça flatte les moyennes) et son happy-flow **clique des carrousels/variantes** (RepAI T5/T6 : 2.48s/0.32s = réponses locales quasi instantanées). Ma règle : contexte froid par conversation + **free-text only, jamais de chips** (anti-triche latence).
6. **Gorgias pas mesuré avec le même instrument.** Son "Gorgias p75 ≈ 16.5s" vient de la télémétrie interne — une AUTRE métrique comparée à ses mesures wire (pommes vs oranges, et le p75 interne n'est ni cold-start ni même définition de "réponse"). Moi je passe Gorgias dans **exactement la même moulinette** que les concurrents. Pour une slide board, c'est la différence entre "défendable" et "contestable".
7. **Pas répétable sans humain.** Skill interactif (plan d'approbation à mi-parcours), lent, "consumes many tokens", pas de parallélisme (il l'avoue dans le thread). Une photo, pas un film. Moi : hebdo automatisé (launchd), time-series, resumable, zéro-touch.

## 4. Divergences factuelles à réconcilier (important avant le board)

| Vendor | Lui (wire, 1 store, juin) | Moi (DOM, multi-stores, juillet) | Lecture |
|---|---|---|---|
| Sierra | 14.1s full (Scotts) | 9.5s avg (7 stores) | cohérent — Scotts est son pire store (moi aussi je le vois lent) ; mon panel est plus large |
| Kodif | 13.3s (DSC) | 15.5s shopping (6 stores) | cohérent (±15%) |
| Siena | 8.5s (Simple Modern) | 12.1s (5 stores) | cohérent — Simple Modern est le meilleur store Siena chez moi aussi |
| **RepAI** | 11.1s, verdict "the strongest — informs, shows, transacts" 🟢🟢 (juin) | **40.3s + qualité 3-11/100, boucle upsell "Auto Deliver" sur TOUTES les questions** (juillet, 4 stores) | ⚠️ GROS écart. Hypothèses : (a) ses moyennes bénéficient des clics carrousel + exclusion de l'outlier 72s ; (b) régression/A-B chez RepAI entre juin et juillet ; (c) nos questions support déclenchent la boucle. À re-tester avec SON listener réseau pour trancher — si RepAI a régressé, c'est une trouvaille de time-series que seul MON système détecte. |
| **Yuma/Tediber** | 18.9s full — il a obtenu des réponses en free-text (juin) | 0 réponse free-text, chip-gated (juillet) | ⚠️ À réconcilier : config Tediber changée ? A/B ? Mon verdict "Yuma = ticket/email, pas de concierge free-text" doit être re-validé avec son approche long-polling avant d'être asséné au board. |

*(Ces deux flags sont une force, pas une faiblesse : c'est exactement ce que la répétition hebdomadaire détecte et qu'un one-shot ne peut pas voir.)*

## 5. Learnings à intégrer dans MON système (backlog concret)

1. **Exposer le TTFT que je capture déjà** (`ttft_ms` est dans chaque turn !) comme colonne "first signal" dans le report + classer chaque vendor **streaming vs atomique** (détectable au pattern de croissance DOM : incréments multiples vs saut unique). Ça me donne sa dimension "perceived latency" sans réécrire la mesure.
2. **Ajouter une 6ᵉ thématique "guardrails"** (3 sondes : hors-catalogue / écris-du-code / injection+discount) aux deux lanes + rubrique d'éval dédiée. Différenciateur de report, trouvailles mémorables garanties.
3. **Calibration wire-vs-DOM one-shot** : passer son `cdp-ws-listener.mjs` UNE fois sur 2-3 vendors pour mesurer l'offset DOM−wire et le documenter dans Method ("nos chiffres incluent le rendu, +X ms vs réseau"). Tue l'objection de précision en une note de bas de page.
4. **Vidéos Playwright** (record 1 conversation vitrine par vendor) pour le board.
5. **Ajouter 3 vendors** : Google Agentic/Nordstrom (prioritaire — c'est Google qui entre sur notre marché), Klaviyo K:AI (nanuk.com, nakedwardrobe.com, happywax.com — vérifiés par lui), Shopify Inbox (schottnyc.com, jnco.com ; s'attendre au pattern single-shot).
6. **Vérif add-to-cart via `/cart.js`** dans la matrice capabilities (il a prouvé que des boutons panier sont factices — Yuma).
7. Reprendre son idée produit "cards avant le texte" dans ma page takeaways (elle converge avec mon gap rich-elements et la renforce).

## 6. L'argumentaire "pourquoi mon système est plus précis" (si on me le demande)

> "Roman a construit un excellent **microscope** : la mesure wire d'UNE conversation sur UN marchand est plus fine que la mienne, et ses découvertes de transport sont précieuses. Moi j'ai construit le **télescope** : ce que le board doit savoir, c'est la performance d'une PLATEFORME, pas d'une démo. Et là, la précision vient de l'échantillonnage, pas de l'horloge : 60+ stores, deux lanes séparées, contexte froid, free-text only, des dizaines de tours par vendor, 302 conversations jugées sur rubrique, Gorgias passé dans la même moulinette que les concurrents (pas un p75 interne incomparable), et une répétition hebdomadaire qui transforme la photo en film. Son propre doc contient la preuve : le marchand-vitrine de Klaviyo était le pire de ses 4 déploiements. Un benchmark à n=1 marchand et n=4 tours ne peut pas être précis sur la question qui compte — il peut juste être précis sur la mauvaise question."

Et l'aveu qui crédibilise : *"sa décomposition first-meaningful-content est meilleure que la mienne, je l'intègre."*

## 7. Politique de fusion (Romain L. a demandé UNE seule chose partagée)

Romain Lapeyre (thread, 2026-07-02) : *"can you add what you built this weekend into this same skill? Would rather have one shared thing we all extend."* Position à tenir :
- **Deux couches complémentaires, un seul produit** : le skill context-factory = mode "deep-dive interactif" (1 marchand, wire-level, vidéos) ; mon repo = le "fleet mode" automatisé (échelle, automation rate, evals, time-series, hebdo).
- Concrètement : PR sur `ai_agent_benchmark/SKILL.md` ajoutant une section "Fleet benchmark (automated)" qui pointe vers `max-pruv/ai-chat-latency-benchmark` + fait consommer mon `eval-scores.json`/ledger par son rapport Notion et la slide board. Son ledger garde le per-merchant deep-dive ; mes chiffres deviennent la source des moyennes/classements.
- Ivan Kozlov a aussi "done some work" (dixit Romain L.) — à sourcer avant la réunion pour ne pas être surpris. *(Non mentionné dans le doc Notion de Roman.)*
