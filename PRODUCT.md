# TapCart

register: product

TapCart is multi-tenant retail software for stores that sell physical items by tap. One NFC or QR tag identifies one physical unit, and a PostgreSQL protocol guarantees one owner at a time and one sale per unit per epoch. The transaction design comes from the research manuscript `nfc.tex`.

## Users

- **Store owners and managers** set up the catalog, team and plan, usually on a laptop in a back office.
- **Store staff** work the floor and the desk on whatever device is nearby, often while talking to a customer.
- **Shoppers** stand in an aisle with one phone and one free hand, on a link they just tapped.
- **Platform administrators** approve stores and apply plans.

## Principles

- Truth over reassurance: show the real unit, lease, payment and plan state. Never imply a sale, delivery or charge that did not happen.
- Status before promotion: what needs action comes first.
- Static tags identify a record. They are never presented as proof of authenticity.

## Tone

Plain, specific, calm. Controls name their action. No whimsy, no slogans inside the product.
