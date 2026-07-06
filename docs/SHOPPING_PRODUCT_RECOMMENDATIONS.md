# Shopping Assistant product recommendations

Generated from captured Shopping Assistant conversations in `2026-07-01, 2026-07-02, 2026-07-03, 2026-07-06`.
Ranking window: `2026-07-01` to `2026-07-06`.

Definition: counts distinct product recommendations with transcript evidence. Product cards, product links, and named products in recommendation phrases count. Generic categories alone do not count, so this is a conservative lower-bound. Card-only recommendations that are not serialized into the captured transcript can be undercounted.

## Vendor Summary

| Vendor | Conversations | Avg products / conv | Conv with products | Bar | Max in one conv |
|---|---:|---:|---:|---|---:|
| Klaviyo | 3 | 4.67 | 100% | `########################` | 6 |
| Gorgias | 32 | 3.19 | 97% | `################` | 9 |
| Envive | 14 | 1.86 | 64% | `##########` | 7 |
| Siena | 27 | 1.63 | 70% | `########` | 5 |
| Kodif | 39 | 0.54 | 28% | `###` | 7 |
| Yuma | 14 | 0.50 | 36% | `###` | 2 |
| Decagon | 4 | 0.50 | 25% | `###` | 2 |
| DigitalGenius | 18 | 0.28 | 22% | `#` | 2 |
| Ada | 41 | 0.24 | 20% | `#` | 2 |
| Sierra | 38 | 0.03 | 3% | `#` | 1 |
| Meta AI | 5 | 0.00 | 0% | `-` | 0 |
| Rep AI | 9 | 0.00 | 0% | `-` | 0 |

## Per Conversation

| Vendor | Store | Theme | Products | Bar | Products detected | Conversation |
|---|---|---|---:|---|---|---|
| Gorgias | Addison Bay | Gift shopper | 9 | `########################` | AB Varsity Socks; Addison Bay Embroidered Hat; Behr Set X Cecil & Lou; Charlotte Set X Cecil & Lou; Drape Luxe Everyday Long Sleeve; Everyday Crewneck; Get Involved E-Gift Card; Polished Double Knit Everyday Quarter Zip; Scuba Light Bainbridge Quarter Zip Sweatshirt | `2026-07-03/gorgias-addisonbay-shopping-gift.json` |
| Gorgias | Shoebacca | Gift shopper | 9 | `########################` | adidas Kaptir Base Lace Up Sneakers; Essentials Fleece Pullover Hoodie; Essentials Graphics Tee; Essentials Hoodie; Essentials Joggers; Everyday Performance Adjustable Cap; Fremont High Top Sneakers; Neck Sweatshirt; Wardrobe Essentials Go Together Sweatpants | `2026-07-01/gorgias-shoebacca-shopping-gift.json` |
| Gorgias | Amicci | Comparison, budget-tight | 8 | `#####################` | Black Chain Necklace; Blaise Cotton Twill Beige Shirt; Blue Slim Jean; Dakota Denim Jacket; Keshi Denim Shirt Black; Lennox Black Straight Jean; Vesper Linen Pants Beige; White Chain Necklace | `2026-07-03/gorgias-amicci-shopping-compare-budget.json` |
| Envive | Bandolier | Comparison, budget-tight | 7 | `###################` | Hailey Chrome - Black Chrome/Gold; Hailey Pouch Set - Black/Gold; Lily Chrome - Ceci Blue Floral Chrome/Gold; Lily Pouch Set - Black/Gold; Mila Pouch Set - Black/Gold; Rayna Pouch Set - Black/Chrome Gold; Remi Magnet - Black Croc/Gold | `2026-07-02/envive-bandolier-shopping-compare-budget.json` |
| Gorgias | Amicci | Gift shopper | 7 | `###################` | Black Chain Necklace; Denim Tote Bag; Gift Cards; Jerozi Black Sweatshirt; Layered Silver Point Necklace; Silver Layered Chain Necklace; Tatum Brown Needle Cord Jacket | `2026-07-03/gorgias-amicci-shopping-gift.json` |
| Kodif | Dollar Shave Club | Comparison, budget-tight | 7 | `###################` | Call of Duty® Tactical Bundle; Classic 4 Blade Razor; Clean Slate Bundle; Fresh Start Bundle; Ohio State University Gift Set; Quickie Bundle; Signature 6 Blade Razor | `2026-07-03/kodif-dsc-shopping-compare-budget.json` |
| Envive | Bandolier | Everyday value buyer | 6 | `################` | Hailey Chrome - Black Chrome/Gold; Hailey Chrome - Navy/Chrome Gold; Lily Chrome - Black/Chrome Gold; Lily Chrome - Ceci Blue Floral Chrome/Gold; Remi Magnet - Black/Gold; Remi Magnet - Indigo/Gold | `2026-07-02/envive-bandolier-shopping-everyday-value.json` |
| Envive | Bandolier | Gift shopper | 6 | `################` | Dillon Crossbody Bag - Black/Gold; Large Expanded Pouch - Black/Gold; Lily Duet - Black/Gold; Mila Pouch Set - Black/Gold; Miller Bag - Black/Gold; Toiletry Trio Bags - Black/Gold | `2026-07-02/envive-bandolier-shopping-gift.json` |
| Gorgias | Shoebacca | Gift shopper | 6 | `################` | Essentials Fleece Pullover Hoodie; Essentials Linear Full Zip Hoodie; Shoebacca E-Gift Card; Slip-ins Hotshot Everyday Ease Slip On Sneakers; Slip-ins Summits Everyday Set Slip On Sneakers; Tecovas Leather Basics Care Kit | `2026-07-02/gorgias-shoebacca-shopping-gift.json` |
| Klaviyo | NANUK | Specific need / reassurance | 6 | `################` | NANUK 225 Broadhead holder Kit; NANUK 910 First Aid case; NANUK 945 Olive - Old Mold; NANUK-R 915 Pro Photo Kit; NANUK-R 935 Pro Photo Kit; Padded Dividers | `2026-07-06/klaviyo-nanuk-shopping-problem-solver.json` |
| Gorgias | Addison Bay | Everyday value buyer | 5 | `#############` | Active Mesh Everyday Tank Bundle; Everyday Crewneck; Polished Double Knit Everyday Quarter Zip; Sculpt Compression High-Rise Everyday Legging; Smooth Sport Rally Active Dress | `2026-07-03/gorgias-addisonbay-shopping-everyday-value.json` |
| Gorgias | Amicci | Specific need / reassurance | 5 | `#############` | Fonsie Textured Bomber Jacket; Fonsie Textured Joggers; Fulton Leather Varsity Jacket; Ravenna Shirt; Taras Navy Varsity Jacket | `2026-07-03/gorgias-amicci-shopping-problem-solver.json` |
| Klaviyo | NANUK | Everyday value buyer | 5 | `#############` | Nanuk 915 Empty; NANUK 920 Empty; NANUK 930; NANUK 940 Empty; NANUK-R 915 Pro Photo Kit | `2026-07-06/klaviyo-nanuk-shopping-everyday-value.json` |
| Siena | Simple Modern | Gift shopper | 5 | `#############` | Bennett Silicone Bib; Ellie Snack Bag; Mesa Loop 30oz Tumbler; Mesa Loop with Covered Straw; Personalized Embroidery | `2026-07-03/siena-simplemodern-shopping-gift.json` |
| Siena | Simple Modern | Gift shopper | 5 | `#############` | Bennett Silicone Bib; Ellie Snack Bag; Mesa Loop 30oz; Mesa Loop with Covered Straw; Personalized Embroidery | `2026-07-06/siena-simplemodern-shopping-gift.json` |
| Gorgias | Shoebacca | Everyday value buyer | 4 | `###########` | adidas Daily 3; Daily 3.0 Lace Up Sneakers; Daily 4.0 Lace Up Sneakers; Trudell Wingtip Lace Up Oxford Shoes | `2026-07-01/gorgias-shoebacca-shopping-everyday-value.json` |
| Gorgias | Addison Bay | Specific need / reassurance | 3 | `########` | AB Shopper Tote; Smooth Sport Cloisters Active Dress; Smooth Sport Rally Active Dress | `2026-07-03/gorgias-addisonbay-shopping-problem-solver.json` |
| Gorgias | Beekman 1802 | Comparison, budget-tight | 3 | `########` | 3 Simple Steps Skincare Set; Hydration Station Skincare Set; Milky Must Haves 3 Piece Skincare Set | `2026-07-01/gorgias-beekman-shopping-compare-budget.json` |
| Gorgias | Beekman 1802 | Specific need / reassurance | 3 | `########` | Hydration Station Skincare Set; Milk RX Advanced Better Aging Cream; Milk RX Advanced Better Aging Wrinkle Serum | `2026-07-01/gorgias-beekman-shopping-problem-solver.json` |
| Gorgias | Beekman 1802 | Comparison, budget-tight | 3 | `########` | 3 Simple Steps Skincare Set; Hydration Station Skincare Set; Milky Must-Haves 3-Piece Skincare Set | `2026-07-02/gorgias-beekman-shopping-compare-budget.json` |
| Gorgias | Beekman 1802 | Gift shopper | 3 | `########` | 3 Simple Steps Skincare Set; Iconic Essentials Skincare Gift Set; Oh! Mega Moisture Face & Lip Duo | `2026-07-02/gorgias-beekman-shopping-gift.json` |
| Gorgias | Ice-Watch | Everyday value buyer | 3 | `########` | ICE power Golden Black, 36 mm; ICE power Sunset Blue Shades, 36 mm; ICE power White Clear Pink, 36 mm | `2026-07-03/gorgias-icewatch-shopping-everyday-value.json` |
| Gorgias | Shoebacca | Total beginner | 3 | `########` | adidas Everyset Versatile Training Shoes; Break Start Low Lace Up Sneakers; Break Start Shoes | `2026-07-01/gorgias-shoebacca-shopping-beginner.json` |
| Gorgias | Shoebacca | Specific need / reassurance | 3 | `########` | Essentials Feel Cozy Sweatpants; Made With Quality Sweatpants; Premium Essentials Cargo Pants | `2026-07-01/gorgias-shoebacca-shopping-problem-solver.json` |
| Gorgias | Shoebacca | Everyday value buyer | 3 | `########` | Daily 3.0 Lace Up Sneakers; Daily 4.0 Lace Up Sneakers; Keds Double Decker Canvas Slip On Sneakers | `2026-07-02/gorgias-shoebacca-shopping-everyday-value.json` |
| Klaviyo | NANUK | Comparison, budget-tight | 3 | `########` | NANUK 918; NANUK 925; NANUK 930 | `2026-07-06/klaviyo-nanuk-shopping-compare-budget.json` |
| Kodif | Dollar Shave Club | Comparison, budget-tight | 3 | `########` | Classic 4 Blade Razor; Humble Twin Blade; Men's Signature 6 Blade Razor | `2026-07-02/kodif-dsc-shopping-compare-budget.json` |
| Siena | Simple Modern | Comparison, budget-tight | 3 | `########` | Mesa Loop 30oz; Mesa Loop with Covered Straw; NFL Trek Tumbler | `2026-07-02/siena-simplemodern-shopping-compare-budget.json` |
| Siena | Simple Modern | Everyday value buyer | 3 | `########` | Bennett Silicone Bib; Mesa Loop with Covered Straw; Trek Tumbler | `2026-07-02/siena-simplemodern-shopping-everyday-value.json` |
| Siena | Simple Modern | Specific need / reassurance | 3 | `########` | Mesa Loop 30oz; Mesa Loop Replacement Straws; Mesa Loop with Covered Straw | `2026-07-02/siena-simplemodern-shopping-problem-solver.json` |
| Siena | Simple Modern | Comparison, budget-tight | 3 | `########` | Mesa Loop 30oz Tumbler; Mesa Loop with Covered Straw; Voyager Tumbler - Signature | `2026-07-03/siena-simplemodern-shopping-compare-budget.json` |
| Siena | Simple Modern | Everyday value buyer | 3 | `########` | Mesa Loop with Covered Straw; Trek Pivot Tumbler; Trek Tumbler | `2026-07-03/siena-simplemodern-shopping-everyday-value.json` |
| Ada | Alen | Everyday value buyer | 2 | `#####` | BreatheSmart 35i; BreatheSmart 45i | `2026-07-03/ada-alen-shopping-everyday-value.json` |
| Ada | Alen | Specific need / reassurance | 2 | `#####` | Alen BreatheSmart 45i; Essential for dust/allergens - Advanced for smoke/chemic | `2026-07-03/ada-alen-shopping-problem-solver.json` |
| Decagon | Oura | Everyday value buyer | 2 | `#####` | Oura Ring 4; Oura Ring 5 | `2026-07-06/decagon-oura-shopping-everyday-value.json` |
| DigitalGenius | Bloom & Wild | Comparison, budget-tight | 2 | `#####` | Add multiple items to your basket; Refer a friend | `2026-07-01/dg-bloomwild-shopping-compare-budget.json` |
| Envive | Kut from the Kloth | Total beginner | 2 | `#####` | Blair High Rise Straight Leg in Thrive Wash; Kp2451ma4 Blair High Rise Straight Leg Thrive | `2026-07-02/envive-kut-shopping-beginner.json` |
| Gorgias | Addison Bay | Total beginner | 2 | `#####` | Smooth Sport Volley Active Dress; Sport Light 15in Baseline Skort | `2026-07-03/gorgias-addisonbay-shopping-beginner.json` |
| Gorgias | Amicci | Total beginner | 2 | `#####` | America and Australia/New Zealand; Rest of the world | `2026-07-03/gorgias-amicci-shopping-beginner.json` |
| Gorgias | Amicci | Everyday value buyer | 2 | `#####` | Lennox Black Straight Jean; Luciano Windbreaker Black | `2026-07-03/gorgias-amicci-shopping-everyday-value.json` |
| Gorgias | Beekman 1802 | Total beginner | 2 | `#####` | 3 Simple Steps Skincare Set; Fun in the Sun Travel Pack | `2026-07-01/gorgias-beekman-shopping-beginner.json` |
| Gorgias | Beekman 1802 | Gift shopper | 2 | `#####` | Fun in the Sun Travel Pack; Milky Must-Haves 3-Piece Skincare Set | `2026-07-01/gorgias-beekman-shopping-gift.json` |
| Gorgias | Beekman 1802 | Everyday value buyer | 2 | `#####` | All-in-One Skincare Routine; Milky Must-Haves 3-Piece Skincare Set | `2026-07-02/gorgias-beekman-shopping-everyday-value.json` |
| Gorgias | Beekman 1802 | Specific need / reassurance | 2 | `#####` | Milk RX Advanced Better Aging Cream; Milk RX cream or the full routine | `2026-07-02/gorgias-beekman-shopping-problem-solver.json` |
| Gorgias | Shoebacca | Comparison, budget-tight | 2 | `#####` | AP1 and lock in the smarter; AP1 Walking Shoes | `2026-07-01/gorgias-shoebacca-shopping-compare-budget.json` |
| Kodif | Dollar Shave Club | Everyday value buyer | 2 | `#####` | Classic 4 Blade Razor; Signature 6 Blade Razor | `2026-07-03/kodif-dsc-shopping-everyday-value.json` |
| Kodif | Namesake | Comparison, budget-tight | 2 | `#####` | Newton Mini Crib Mattress \| Final Sale; Pure Core Mini Crib Mattress w/ Hybrid Quilted Waterproof Cover | `2026-07-02/kodif-namesake-shopping-compare-budget.json` |
| Siena | Simple Modern | Total beginner | 2 | `#####` | Mesa Loop 30oz; Mesa Loop with Covered Straw | `2026-07-01/siena-simplemodern-shopping-beginner.json` |
| Siena | Simple Modern | Comparison, budget-tight | 2 | `#####` | Collegiate Trek Tumbler; NFL Trek Tumbler | `2026-07-01/siena-simplemodern-shopping-compare-budget.json` |
| Siena | Simple Modern | Total beginner | 2 | `#####` | Mesa Loop 30oz; Mesa Loop with Covered Straw | `2026-07-02/siena-simplemodern-shopping-beginner.json` |
| Siena | Simple Modern | Gift shopper | 2 | `#####` | Mesa Loop 30oz; Mesa Loop with Covered Straw | `2026-07-02/siena-simplemodern-shopping-gift.json` |
| Siena | Simple Modern | Total beginner | 2 | `#####` | Mesa Loop 30oz in Coconut Pearl as your starter pick; Mesa Loop with Covered Straw | `2026-07-03/siena-simplemodern-shopping-beginner.json` |
| Siena | Simple Modern | Comparison, budget-tight | 2 | `#####` | Mesa Loop with Covered Straw; Summit Water Bottle 32oz | `2026-07-06/siena-simplemodern-shopping-compare-budget.json` |
| Siena | Simple Modern | Everyday value buyer | 2 | `#####` | Mesa Loop with Covered Straw; Trek Tumbler 40oz | `2026-07-06/siena-simplemodern-shopping-everyday-value.json` |
| Yuma | EvryJewels | Gift shopper | 2 | `#####` | Gift Card Value; Special Occasion Box | `2026-07-03/yuma-evryjewels-shopping-gift.json` |
| Yuma | EvryJewels | Gift shopper | 2 | `#####` | Gift Card Value; Special Occasion Box | `2026-07-06/yuma-evryjewels-shopping-gift.json` |
| Ada | Alen | Comparison, budget-tight | 1 | `###` | Yes - BreatheSmart 45i | `2026-07-03/ada-alen-shopping-compare-budget.json` |
| Ada | Goodfood | Total beginner | 1 | `###` | Customize your recipes | `2026-07-03/ada-goodfood-shopping-beginner.json` |
| Ada | Goodfood | Comparison, budget-tight | 1 | `###` | Plan for a | `2026-07-03/ada-goodfood-shopping-compare-budget.json` |
| Ada | Goodfood | Everyday value buyer | 1 | `###` | Meal Kits | `2026-07-03/ada-goodfood-shopping-everyday-value.json` |
| Ada | Loop Earplugs | Total beginner | 1 | `###` | Loop Experience 2 Earplugs - Focus/tr | `2026-07-03/ada-loop-shopping-beginner.json` |
| Ada | Loop Earplugs | Gift shopper | 1 | `###` | Loop Engage 2 | `2026-07-03/ada-loop-shopping-gift.json` |
| DigitalGenius | Bloom & Wild | Comparison, budget-tight | 1 | `###` | Earn 5 points per | `2026-07-02/dg-bloomwild-shopping-compare-budget.json` |
| DigitalGenius | Bloom & Wild | Comparison, budget-tight | 1 | `###` | Loyalty Programme | `2026-07-03/dg-bloomwild-shopping-compare-budget.json` |
| DigitalGenius | Bloom & Wild | Comparison, budget-tight | 1 | `###` | Earn 5 points per | `2026-07-06/dg-bloomwild-shopping-compare-budget.json` |
| Envive | Bandolier | Total beginner | 1 | `###` | Hailey Chrome - Black Chrome/Gold | `2026-07-02/envive-bandolier-shopping-beginner.json` |
| Envive | Bandolier | Specific need / reassurance | 1 | `###` | Hailey - Black/Gold | `2026-07-02/envive-bandolier-shopping-problem-solver.json` |
| Envive | Kut from the Kloth | Total beginner | 1 | `###` | Kp494mq6u Catherine Boyfriend Black | `2026-07-01/envive-kut-shopping-beginner.json` |
| Envive | Kut from the Kloth | Gift shopper | 1 | `###` | Gift Card | `2026-07-01/envive-kut-shopping-gift.json` |
| Envive | Kut from the Kloth | Specific need / reassurance | 1 | `###` | Kg1753mc4 Meg High Rise Wide Leg Totally | `2026-07-02/envive-kut-shopping-problem-solver.json` |
| Gorgias | Addison Bay | Comparison, budget-tight | 1 | `###` | Addison Bay Embroidered Hat | `2026-07-03/gorgias-addisonbay-shopping-compare-budget.json` |
| Gorgias | Beekman 1802 | Everyday value buyer | 1 | `###` | Milky Must-Haves 3-Piece Skincare Set | `2026-07-01/gorgias-beekman-shopping-everyday-value.json` |
| Gorgias | Beekman 1802 | Total beginner | 1 | `###` | 3 Simple Steps Skincare Set | `2026-07-02/gorgias-beekman-shopping-beginner.json` |
| Gorgias | Ice-Watch | Comparison, budget-tight | 1 | `###` | ICE power White Gold, or do you want the more elevated WP4 feel | `2026-07-03/gorgias-icewatch-shopping-compare-budget.json` |
| Gorgias | Ice-Watch | Gift shopper | 1 | `###` | ICE power Sunset Blue Shades | `2026-07-03/gorgias-icewatch-shopping-gift.json` |
| Gorgias | Ice-Watch | Specific need / reassurance | 1 | `###` | ICE glam Black Rose-Gold | `2026-07-03/gorgias-icewatch-shopping-problem-solver.json` |
| Kodif | Babyletto | Gift shopper | 1 | `###` | Babyletto Gift Card | `2026-07-02/kodif-babyletto-shopping-gift.json` |
| Kodif | Dollar Shave Club | Total beginner | 1 | `###` | Humble Beginnings Starter Set | `2026-07-01/kodif-dsc-shopping-beginner.json` |
| Kodif | Dollar Shave Club | Gift shopper | 1 | `###` | Fully Loaded Starter Set | `2026-07-01/kodif-dsc-shopping-gift.json` |
| Kodif | Dollar Shave Club | Everyday value buyer | 1 | `###` | Signature 6 Blade Razor | `2026-07-02/kodif-dsc-shopping-everyday-value.json` |
| Kodif | Dollar Shave Club | Gift shopper | 1 | `###` | Whether you're shopping for College Students, Dads, or for Family Gifting | `2026-07-03/kodif-dsc-shopping-gift.json` |
| Kodif | Dollar Shave Club | Gift shopper | 1 | `###` | Plus, we've got some sweet deals going on! You can get FREE Ball Spray when you spend | `2026-07-06/kodif-dsc-shopping-gift.json` |
| Kodif | JustFoodForDogs | Gift shopper | 1 | `###` | Sampler Variety Box | `2026-07-02/kodif-jffd-shopping-gift.json` |
| Siena | MUD\WTR | Total beginner | 1 | `###` | Coffee Starter Kit | `2026-07-02/siena-mudwtr-shopping-beginner.json` |
| Siena | MUD\WTR | Gift shopper | 1 | `###` | Original Starter Kit | `2026-07-02/siena-mudwtr-shopping-gift.json` |
| Siena | Simple Modern | Everyday value buyer | 1 | `###` | Trek Tumbler 40oz | `2026-07-01/siena-simplemodern-shopping-everyday-value.json` |
| Siena | Simple Modern | Gift shopper | 1 | `###` | Getaway Bag | `2026-07-01/siena-simplemodern-shopping-gift.json` |
| Siena | Simple Modern | Specific need / reassurance | 1 | `###` | Mesa Loop Replacement Straws | `2026-07-03/siena-simplemodern-shopping-problem-solver.json` |
| Sierra | Casper | Comparison, budget-tight | 1 | `###` | Casper One Foam | `2026-07-03/sierra-casper-shopping-compare-budget.json` |
| Yuma | EvryJewels | Total beginner | 1 | `###` | I'd love to do that for you! | `2026-07-03/yuma-evryjewels-shopping-beginner.json` |
| Yuma | EvryJewels | Everyday value buyer | 1 | `###` | Silver finish for your bundle | `2026-07-03/yuma-evryjewels-shopping-everyday-value.json` |
| Yuma | EvryJewels | Everyday value buyer | 1 | `###` | Evry Insider ambassador program, you'll receive a | `2026-07-06/yuma-evryjewels-shopping-everyday-value.json` |
| Ada | Alen | Total beginner | 0 | `-` | - | `2026-07-03/ada-alen-shopping-beginner.json` |
| Ada | Alen | Gift shopper | 0 | `-` | - | `2026-07-03/ada-alen-shopping-gift.json` |
| Ada | American Tall | Everyday value buyer | 0 | `-` | - | `2026-07-03/ada-americantall-shopping-everyday-value.json` |
| Ada | American Tall | Specific need / reassurance | 0 | `-` | - | `2026-07-03/ada-americantall-shopping-problem-solver.json` |
| Ada | Goodfood | Gift shopper | 0 | `-` | - | `2026-07-03/ada-goodfood-shopping-gift.json` |
| Ada | Goodfood | Specific need / reassurance | 0 | `-` | - | `2026-07-03/ada-goodfood-shopping-problem-solver.json` |
| Ada | IPSY | Total beginner | 0 | `-` | - | `2026-07-02/ada-ipsy-shopping-beginner.json` |
| Ada | IPSY | Comparison, budget-tight | 0 | `-` | - | `2026-07-02/ada-ipsy-shopping-compare-budget.json` |
| Ada | IPSY | Everyday value buyer | 0 | `-` | - | `2026-07-02/ada-ipsy-shopping-everyday-value.json` |
| Ada | IPSY | Gift shopper | 0 | `-` | - | `2026-07-02/ada-ipsy-shopping-gift.json` |
| Ada | IPSY | Specific need / reassurance | 0 | `-` | - | `2026-07-02/ada-ipsy-shopping-problem-solver.json` |
| Ada | Knix | Total beginner | 0 | `-` | - | `2026-07-03/ada-knix-shopping-beginner.json` |
| Ada | Knix | Comparison, budget-tight | 0 | `-` | - | `2026-07-03/ada-knix-shopping-compare-budget.json` |
| Ada | Knix | Everyday value buyer | 0 | `-` | - | `2026-07-03/ada-knix-shopping-everyday-value.json` |
| Ada | Knix | Gift shopper | 0 | `-` | - | `2026-07-03/ada-knix-shopping-gift.json` |
| Ada | Knix | Specific need / reassurance | 0 | `-` | - | `2026-07-03/ada-knix-shopping-problem-solver.json` |
| Ada | Loop Earplugs | Total beginner | 0 | `-` | - | `2026-07-01/ada-loop-shopping-beginner.json` |
| Ada | Loop Earplugs | Comparison, budget-tight | 0 | `-` | - | `2026-07-01/ada-loop-shopping-compare-budget.json` |
| Ada | Loop Earplugs | Everyday value buyer | 0 | `-` | - | `2026-07-01/ada-loop-shopping-everyday-value.json` |
| Ada | Loop Earplugs | Gift shopper | 0 | `-` | - | `2026-07-01/ada-loop-shopping-gift.json` |
| Ada | Loop Earplugs | Specific need / reassurance | 0 | `-` | - | `2026-07-01/ada-loop-shopping-problem-solver.json` |
| Ada | Loop Earplugs | Comparison, budget-tight | 0 | `-` | - | `2026-07-03/ada-loop-shopping-compare-budget.json` |
| Ada | Loop Earplugs | Everyday value buyer | 0 | `-` | - | `2026-07-03/ada-loop-shopping-everyday-value.json` |
| Ada | Loop Earplugs | Specific need / reassurance | 0 | `-` | - | `2026-07-03/ada-loop-shopping-problem-solver.json` |
| Ada | Loop Earplugs | Comparison, budget-tight | 0 | `-` | - | `2026-07-06/ada-loop-shopping-compare-budget.json` |
| Ada | Loop Earplugs | Everyday value buyer | 0 | `-` | - | `2026-07-06/ada-loop-shopping-everyday-value.json` |
| Ada | Loop Earplugs | Gift shopper | 0 | `-` | - | `2026-07-06/ada-loop-shopping-gift.json` |
| Ada | Loop Earplugs | Specific need / reassurance | 0 | `-` | - | `2026-07-06/ada-loop-shopping-problem-solver.json` |
| Ada | Peet's Coffee | Total beginner | 0 | `-` | - | `2026-07-03/ada-peets-shopping-beginner.json` |
| Ada | Peet's Coffee | Comparison, budget-tight | 0 | `-` | - | `2026-07-03/ada-peets-shopping-compare-budget.json` |
| Ada | Peet's Coffee | Everyday value buyer | 0 | `-` | - | `2026-07-03/ada-peets-shopping-everyday-value.json` |
| Ada | Peet's Coffee | Gift shopper | 0 | `-` | - | `2026-07-03/ada-peets-shopping-gift.json` |
| Ada | Peet's Coffee | Specific need / reassurance | 0 | `-` | - | `2026-07-03/ada-peets-shopping-problem-solver.json` |
| Decagon | Oura | Comparison, budget-tight | 0 | `-` | - | `2026-07-06/decagon-oura-shopping-compare-budget.json` |
| Decagon | Oura | Gift shopper | 0 | `-` | - | `2026-07-06/decagon-oura-shopping-gift.json` |
| Decagon | Oura | Specific need / reassurance | 0 | `-` | - | `2026-07-06/decagon-oura-shopping-problem-solver.json` |
| DigitalGenius | Bloom & Wild | Total beginner | 0 | `-` | - | `2026-07-01/dg-bloomwild-shopping-beginner.json` |
| DigitalGenius | Bloom & Wild | Gift shopper | 0 | `-` | - | `2026-07-01/dg-bloomwild-shopping-gift.json` |
| DigitalGenius | Bloom & Wild | Specific need / reassurance | 0 | `-` | - | `2026-07-01/dg-bloomwild-shopping-problem-solver.json` |
| DigitalGenius | Bloom & Wild | Gift shopper | 0 | `-` | - | `2026-07-02/dg-bloomwild-shopping-gift.json` |
| DigitalGenius | Bloom & Wild | Specific need / reassurance | 0 | `-` | - | `2026-07-02/dg-bloomwild-shopping-problem-solver.json` |
| DigitalGenius | Bloom & Wild | Total beginner | 0 | `-` | - | `2026-07-03/dg-bloomwild-shopping-beginner.json` |
| DigitalGenius | Bloom & Wild | Gift shopper | 0 | `-` | - | `2026-07-03/dg-bloomwild-shopping-gift.json` |
| DigitalGenius | Bloom & Wild | Specific need / reassurance | 0 | `-` | - | `2026-07-03/dg-bloomwild-shopping-problem-solver.json` |
| DigitalGenius | Bloom & Wild | Gift shopper | 0 | `-` | - | `2026-07-06/dg-bloomwild-shopping-gift.json` |
| DigitalGenius | Bloom & Wild | Specific need / reassurance | 0 | `-` | - | `2026-07-06/dg-bloomwild-shopping-problem-solver.json` |
| DigitalGenius | G-Star RAW | Everyday value buyer | 0 | `-` | - | `2026-07-01/dg-gstar-shopping-everyday-value.json` |
| DigitalGenius | G-Star RAW | Comparison, budget-tight | 0 | `-` | - | `2026-07-02/dg-gstar-shopping-compare-budget.json` |
| DigitalGenius | G-Star RAW | Everyday value buyer | 0 | `-` | - | `2026-07-02/dg-gstar-shopping-everyday-value.json` |
| DigitalGenius | G-Star RAW | Gift shopper | 0 | `-` | - | `2026-07-02/dg-gstar-shopping-gift.json` |
| Envive | Kut from the Kloth | Everyday value buyer | 0 | `-` | - | `2026-07-01/envive-kut-shopping-everyday-value.json` |
| Envive | Kut from the Kloth | Specific need / reassurance | 0 | `-` | - | `2026-07-01/envive-kut-shopping-problem-solver.json` |
| Envive | Kut from the Kloth | Comparison, budget-tight | 0 | `-` | - | `2026-07-02/envive-kut-shopping-compare-budget.json` |
| Envive | Kut from the Kloth | Everyday value buyer | 0 | `-` | - | `2026-07-02/envive-kut-shopping-everyday-value.json` |
| Envive | Kut from the Kloth | Gift shopper | 0 | `-` | - | `2026-07-02/envive-kut-shopping-gift.json` |
| Gorgias | Ice-Watch | Total beginner | 0 | `-` | - | `2026-07-03/gorgias-icewatch-shopping-beginner.json` |
| Kodif | Babyletto | Total beginner | 0 | `-` | - | `2026-07-02/kodif-babyletto-shopping-beginner.json` |
| Kodif | Babyletto | Comparison, budget-tight | 0 | `-` | - | `2026-07-02/kodif-babyletto-shopping-compare-budget.json` |
| Kodif | Babyletto | Everyday value buyer | 0 | `-` | - | `2026-07-02/kodif-babyletto-shopping-everyday-value.json` |
| Kodif | Babyletto | Specific need / reassurance | 0 | `-` | - | `2026-07-02/kodif-babyletto-shopping-problem-solver.json` |
| Kodif | daVinci Baby | Total beginner | 0 | `-` | - | `2026-07-02/kodif-davinci-shopping-beginner.json` |
| Kodif | daVinci Baby | Comparison, budget-tight | 0 | `-` | - | `2026-07-02/kodif-davinci-shopping-compare-budget.json` |
| Kodif | daVinci Baby | Everyday value buyer | 0 | `-` | - | `2026-07-02/kodif-davinci-shopping-everyday-value.json` |
| Kodif | daVinci Baby | Gift shopper | 0 | `-` | - | `2026-07-02/kodif-davinci-shopping-gift.json` |
| Kodif | daVinci Baby | Specific need / reassurance | 0 | `-` | - | `2026-07-02/kodif-davinci-shopping-problem-solver.json` |
| Kodif | Dollar Shave Club | Comparison, budget-tight | 0 | `-` | - | `2026-07-01/kodif-dsc-shopping-compare-budget.json` |
| Kodif | Dollar Shave Club | Everyday value buyer | 0 | `-` | - | `2026-07-01/kodif-dsc-shopping-everyday-value.json` |
| Kodif | Dollar Shave Club | Specific need / reassurance | 0 | `-` | - | `2026-07-01/kodif-dsc-shopping-problem-solver.json` |
| Kodif | Dollar Shave Club | Total beginner | 0 | `-` | - | `2026-07-02/kodif-dsc-shopping-beginner.json` |
| Kodif | Dollar Shave Club | Gift shopper | 0 | `-` | - | `2026-07-02/kodif-dsc-shopping-gift.json` |
| Kodif | Dollar Shave Club | Specific need / reassurance | 0 | `-` | - | `2026-07-02/kodif-dsc-shopping-problem-solver.json` |
| Kodif | Dollar Shave Club | Total beginner | 0 | `-` | - | `2026-07-03/kodif-dsc-shopping-beginner.json` |
| Kodif | Dollar Shave Club | Specific need / reassurance | 0 | `-` | - | `2026-07-03/kodif-dsc-shopping-problem-solver.json` |
| Kodif | Dollar Shave Club | Everyday value buyer | 0 | `-` | - | `2026-07-06/kodif-dsc-shopping-everyday-value.json` |
| Kodif | JustFoodForDogs | Total beginner | 0 | `-` | - | `2026-07-02/kodif-jffd-shopping-beginner.json` |
| Kodif | JustFoodForDogs | Comparison, budget-tight | 0 | `-` | - | `2026-07-02/kodif-jffd-shopping-compare-budget.json` |
| Kodif | JustFoodForDogs | Everyday value buyer | 0 | `-` | - | `2026-07-02/kodif-jffd-shopping-everyday-value.json` |
| Kodif | JustFoodForDogs | Specific need / reassurance | 0 | `-` | - | `2026-07-02/kodif-jffd-shopping-problem-solver.json` |
| Kodif | Namesake | Total beginner | 0 | `-` | - | `2026-07-02/kodif-namesake-shopping-beginner.json` |
| Kodif | Namesake | Everyday value buyer | 0 | `-` | - | `2026-07-02/kodif-namesake-shopping-everyday-value.json` |
| Kodif | Namesake | Gift shopper | 0 | `-` | - | `2026-07-02/kodif-namesake-shopping-gift.json` |
| Kodif | Namesake | Specific need / reassurance | 0 | `-` | - | `2026-07-02/kodif-namesake-shopping-problem-solver.json` |
| Kodif | Neuro | Total beginner | 0 | `-` | - | `2026-07-02/kodif-neuro-shopping-beginner.json` |
| Kodif | Neuro | Comparison, budget-tight | 0 | `-` | - | `2026-07-02/kodif-neuro-shopping-compare-budget.json` |
| Meta AI | Grove | Total beginner | 0 | `-` | - | `2026-07-02/meta-grove-shopping-beginner.json` |
| Meta AI | Grove | Comparison, budget-tight | 0 | `-` | - | `2026-07-02/meta-grove-shopping-compare-budget.json` |
| Meta AI | Grove | Everyday value buyer | 0 | `-` | - | `2026-07-02/meta-grove-shopping-everyday-value.json` |
| Meta AI | Grove | Gift shopper | 0 | `-` | - | `2026-07-02/meta-grove-shopping-gift.json` |
| Meta AI | Grove | Specific need / reassurance | 0 | `-` | - | `2026-07-02/meta-grove-shopping-problem-solver.json` |
| Rep AI | Fresh Roasted Coffee | Total beginner | 0 | `-` | - | `2026-07-01/repai-fresh-shopping-beginner.json` |
| Rep AI | Fresh Roasted Coffee | Comparison, budget-tight | 0 | `-` | - | `2026-07-01/repai-fresh-shopping-compare-budget.json` |
| Rep AI | Fresh Roasted Coffee | Everyday value buyer | 0 | `-` | - | `2026-07-01/repai-fresh-shopping-everyday-value.json` |
| Rep AI | Fresh Roasted Coffee | Gift shopper | 0 | `-` | - | `2026-07-01/repai-fresh-shopping-gift.json` |
| Rep AI | Fresh Roasted Coffee | Specific need / reassurance | 0 | `-` | - | `2026-07-01/repai-fresh-shopping-problem-solver.json` |
| Rep AI | Fresh Roasted Coffee | Total beginner | 0 | `-` | - | `2026-07-02/repai-fresh-shopping-beginner.json` |
| Rep AI | Fresh Roasted Coffee | Everyday value buyer | 0 | `-` | - | `2026-07-02/repai-fresh-shopping-everyday-value.json` |
| Rep AI | Fresh Roasted Coffee | Gift shopper | 0 | `-` | - | `2026-07-02/repai-fresh-shopping-gift.json` |
| Rep AI | Fresh Roasted Coffee | Specific need / reassurance | 0 | `-` | - | `2026-07-02/repai-fresh-shopping-problem-solver.json` |
| Siena | FIGS | Gift shopper | 0 | `-` | - | `2026-07-01/siena-figs-shopping-gift.json` |
| Siena | FIGS | Specific need / reassurance | 0 | `-` | - | `2026-07-01/siena-figs-shopping-problem-solver.json` |
| Siena | FIGS | Total beginner | 0 | `-` | - | `2026-07-02/siena-figs-shopping-beginner.json` |
| Siena | FIGS | Specific need / reassurance | 0 | `-` | - | `2026-07-02/siena-figs-shopping-problem-solver.json` |
| Siena | MUD\WTR | Comparison, budget-tight | 0 | `-` | - | `2026-07-02/siena-mudwtr-shopping-compare-budget.json` |
| Siena | MUD\WTR | Everyday value buyer | 0 | `-` | - | `2026-07-02/siena-mudwtr-shopping-everyday-value.json` |
| Siena | MUD\WTR | Specific need / reassurance | 0 | `-` | - | `2026-07-02/siena-mudwtr-shopping-problem-solver.json` |
| Siena | Simple Modern | Specific need / reassurance | 0 | `-` | - | `2026-07-01/siena-simplemodern-shopping-problem-solver.json` |
| Sierra | BARK | Total beginner | 0 | `-` | - | `2026-07-02/sierra-bark-shopping-beginner.json` |
| Sierra | BARK | Comparison, budget-tight | 0 | `-` | - | `2026-07-02/sierra-bark-shopping-compare-budget.json` |
| Sierra | BARK | Everyday value buyer | 0 | `-` | - | `2026-07-02/sierra-bark-shopping-everyday-value.json` |
| Sierra | BARK | Gift shopper | 0 | `-` | - | `2026-07-02/sierra-bark-shopping-gift.json` |
| Sierra | BARK | Specific need / reassurance | 0 | `-` | - | `2026-07-02/sierra-bark-shopping-problem-solver.json` |
| Sierra | Casper | Total beginner | 0 | `-` | - | `2026-07-01/sierra-casper-shopping-beginner.json` |
| Sierra | Casper | Comparison, budget-tight | 0 | `-` | - | `2026-07-01/sierra-casper-shopping-compare-budget.json` |
| Sierra | Casper | Everyday value buyer | 0 | `-` | - | `2026-07-01/sierra-casper-shopping-everyday-value.json` |
| Sierra | Casper | Gift shopper | 0 | `-` | - | `2026-07-01/sierra-casper-shopping-gift.json` |
| Sierra | Casper | Specific need / reassurance | 0 | `-` | - | `2026-07-01/sierra-casper-shopping-problem-solver.json` |
| Sierra | Casper | Total beginner | 0 | `-` | - | `2026-07-03/sierra-casper-shopping-beginner.json` |
| Sierra | Casper | Everyday value buyer | 0 | `-` | - | `2026-07-03/sierra-casper-shopping-everyday-value.json` |
| Sierra | Casper | Gift shopper | 0 | `-` | - | `2026-07-03/sierra-casper-shopping-gift.json` |
| Sierra | Casper | Specific need / reassurance | 0 | `-` | - | `2026-07-03/sierra-casper-shopping-problem-solver.json` |
| Sierra | Casper | Total beginner | 0 | `-` | - | `2026-07-06/sierra-casper-shopping-beginner.json` |
| Sierra | Casper | Comparison, budget-tight | 0 | `-` | - | `2026-07-06/sierra-casper-shopping-compare-budget.json` |
| Sierra | Casper | Everyday value buyer | 0 | `-` | - | `2026-07-06/sierra-casper-shopping-everyday-value.json` |
| Sierra | Casper | Gift shopper | 0 | `-` | - | `2026-07-06/sierra-casper-shopping-gift.json` |
| Sierra | Casper | Specific need / reassurance | 0 | `-` | - | `2026-07-06/sierra-casper-shopping-problem-solver.json` |
| Sierra | Chubbies | Total beginner | 0 | `-` | - | `2026-07-02/sierra-chubbies-shopping-beginner.json` |
| Sierra | Chubbies | Comparison, budget-tight | 0 | `-` | - | `2026-07-02/sierra-chubbies-shopping-compare-budget.json` |
| Sierra | Chubbies | Everyday value buyer | 0 | `-` | - | `2026-07-02/sierra-chubbies-shopping-everyday-value.json` |
| Sierra | Chubbies | Gift shopper | 0 | `-` | - | `2026-07-02/sierra-chubbies-shopping-gift.json` |
| Sierra | Chubbies | Specific need / reassurance | 0 | `-` | - | `2026-07-02/sierra-chubbies-shopping-problem-solver.json` |
| Sierra | Scotts Miracle-Gro | Comparison, budget-tight | 0 | `-` | - | `2026-07-01/sierra-scotts-shopping-compare-budget.json` |
| Sierra | Scotts Miracle-Gro | Everyday value buyer | 0 | `-` | - | `2026-07-01/sierra-scotts-shopping-everyday-value.json` |
| Sierra | Scotts Miracle-Gro | Gift shopper | 0 | `-` | - | `2026-07-01/sierra-scotts-shopping-gift.json` |
| Sierra | Scotts Miracle-Gro | Specific need / reassurance | 0 | `-` | - | `2026-07-01/sierra-scotts-shopping-problem-solver.json` |
| Sierra | Scotts Miracle-Gro | Total beginner | 0 | `-` | - | `2026-07-02/sierra-scotts-shopping-beginner.json` |
| Sierra | Scotts Miracle-Gro | Comparison, budget-tight | 0 | `-` | - | `2026-07-02/sierra-scotts-shopping-compare-budget.json` |
| Sierra | Scotts Miracle-Gro | Everyday value buyer | 0 | `-` | - | `2026-07-02/sierra-scotts-shopping-everyday-value.json` |
| Sierra | Scotts Miracle-Gro | Gift shopper | 0 | `-` | - | `2026-07-02/sierra-scotts-shopping-gift.json` |
| Sierra | Scotts Miracle-Gro | Specific need / reassurance | 0 | `-` | - | `2026-07-02/sierra-scotts-shopping-problem-solver.json` |
| Sierra | Sun & Ski | Comparison, budget-tight | 0 | `-` | - | `2026-07-02/sierra-sunandski-shopping-compare-budget.json` |
| Sierra | Sun & Ski | Everyday value buyer | 0 | `-` | - | `2026-07-02/sierra-sunandski-shopping-everyday-value.json` |
| Sierra | Sun & Ski | Gift shopper | 0 | `-` | - | `2026-07-02/sierra-sunandski-shopping-gift.json` |
| Sierra | Sun & Ski | Specific need / reassurance | 0 | `-` | - | `2026-07-02/sierra-sunandski-shopping-problem-solver.json` |
| Yuma | EvryJewels | Comparison, budget-tight | 0 | `-` | - | `2026-07-03/yuma-evryjewels-shopping-compare-budget.json` |
| Yuma | EvryJewels | Specific need / reassurance | 0 | `-` | - | `2026-07-03/yuma-evryjewels-shopping-problem-solver.json` |
| Yuma | EvryJewels | Comparison, budget-tight | 0 | `-` | - | `2026-07-06/yuma-evryjewels-shopping-compare-budget.json` |
| Yuma | EvryJewels | Specific need / reassurance | 0 | `-` | - | `2026-07-06/yuma-evryjewels-shopping-problem-solver.json` |
| Yuma | Tediber | Total beginner | 0 | `-` | - | `2026-07-03/yuma-tediber-shopping-beginner.json` |
| Yuma | Tediber | Comparison, budget-tight | 0 | `-` | - | `2026-07-03/yuma-tediber-shopping-compare-budget.json` |
| Yuma | Tediber | Everyday value buyer | 0 | `-` | - | `2026-07-03/yuma-tediber-shopping-everyday-value.json` |
| Yuma | Tediber | Gift shopper | 0 | `-` | - | `2026-07-03/yuma-tediber-shopping-gift.json` |
| Yuma | Tediber | Specific need / reassurance | 0 | `-` | - | `2026-07-03/yuma-tediber-shopping-problem-solver.json` |

## Reproduce

```bash
node runner/product-recommendation-bars.js --markdown docs/SHOPPING_PRODUCT_RECOMMENDATIONS.md --json runner/.eval-wip/shopping-product-recommendations.json
```
