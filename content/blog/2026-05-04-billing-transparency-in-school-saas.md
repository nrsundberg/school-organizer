---
title: "Billing transparency in school SaaS: what schools deserve to see"
date: 2026-05-04
slug: billing-transparency-in-school-saas
author: "PickupRoster Team"
excerpt: "Schools and districts deserve to see exactly what they're paying for. Here's how we think about pricing, invoicing, and Stripe Connect at PickupRoster."
tags: ["billing", "pricing", "stripe-connect", "school-saas", "operations"]
image: ""
---

Most school administrators we talk to have a story about a SaaS invoice that surprised them. A per-student fee that quietly tripled when the student count refreshed in August. A "premium support" line item nobody remembers approving. A renewal auto-charged to a card belonging to an assistant principal who left the district two years ago.

We started PickupRoster in part because the front-office staff we kept meeting were already buried in tools, and the billing on those tools was the part nobody had time to audit. So when we sat down to design our pricing and invoicing, we tried to make the boring parts boring on purpose.

This post is about what billing transparency actually looks like in school SaaS — what we expose, what we don't, and how we use Stripe Connect under the hood to keep things honest.

## What "transparent" actually has to mean

Transparency in billing is one of those words that sounds good and gets used to mean almost nothing. For a school customer, we think it has to mean four concrete things.

First, the price has to be a price you can read on a public page without filling out a form. Our Car Line tier is $100 per month per campus, billed monthly, with a 30-day free trial that does not require a credit card. The District tier is custom-quoted for up to 10 schools, and we'll send a written quote before anything is signed. That's the whole pricing page. If a salesperson ever has to whisper a different number to you, something has gone wrong.

Second, the invoice has to match the price. No platform fees that appear only at renewal. No "implementation" surcharge for turning a feature on. If we change pricing for new customers, existing customers stay on what they signed.

Third, the things that *can* legitimately vary — like the number of campuses on a district contract — should be itemized clearly, with the count visible in the customer's billing portal at all times. If a district adds a school mid-year, the prorated charge should be calculable on a napkin, not requested through support.

Fourth, ending the relationship should be at least as easy as starting it. A school should be able to cancel from inside the app, export their data, and get a final invoice that closes out the account. If a vendor makes you call to cancel, that vendor is not transparent.

> If a school has to file a public records request to find out what it's paying you, you don't have a pricing page — you have a pricing rumor.

These four rules are not radical. They are roughly what most schools already expect from their utility bills. The fact that they feel novel in SaaS is a sign of how far the industry has drifted.

## Why Stripe Connect, not just Stripe

We process payments through Stripe Connect rather than a plain Stripe account, and the choice matters more than most customers will ever notice. Connect lets us split a single transaction across multiple destinations and produce an audit trail that names every party.

The most common case where this comes up: a district pays one invoice covering several campuses, but two of those campuses operate under different fiscal authorities (a charter inside a traditional district, say, or a parochial school sharing infrastructure). With Connect, we can attribute the right portion of the payment to the right entity for accounting purposes, while the district still writes one check. Without Connect, that's an Excel reconciliation nightmare that ends up living on someone's desktop.

The other reason we like Connect is that it forces us to be precise about who the merchant of record is for any given charge. When a school pays PickupRoster, PickupRoster is the merchant. We are not laundering payments through a partner, and we are not collecting payments on behalf of a third party who then bills you separately. The receipt the school gets says PickupRoster, and the entity that has to answer questions about that receipt is PickupRoster. That clarity is worth a lot when an auditor calls.

Connect also gives us a clean way to issue refunds. Schools occasionally close mid-year, consolidate, or change their dismissal model in a way that means our product is the wrong fit. When that happens, we'd rather refund the unused portion than argue. Connect makes the refund traceable on both sides, which keeps the conversation short.

## What this looks like inside the product

A few specifics, because abstractions about transparency are cheap.

The billing page inside PickupRoster shows the active subscription, the next billing date, the payment method, the invoice history, and a button to download any past invoice as a PDF. The PDF includes the school's billing address, a line item for each campus, the dates covered, and the total. If a charge was prorated because a campus was added mid-cycle, the proration math is shown on the line — start date, end date, fraction of the period, unit price.

We do not bill per student. We never have. Student counts in K-12 fluctuate enough through the year that a per-student model penalizes growing schools and creates an incentive to dispute headcounts. A flat per-campus fee is easier to budget against and easier to defend at a board meeting.

We do not charge for additional staff seats. If a campus has six office staff who all need access during dismissal, all six get accounts. Charging per seat in a context where the seats are mostly hourly office workers would be petty, and it would push schools to share logins, which is a security problem we don't want to create.

We do not charge for support. Support is part of running a software company; making it a line item is a way of pretending it isn't.

## The 30-day trial, and what happens after

The trial is 30 days, no credit card required, full product. At day 30, if a school hasn't entered payment information, the account suspends. Suspended means the data stays intact for 90 days and the school can resume by adding a payment method. After 90 days of suspension we email a final notice and then delete the tenant.

We chose suspend-on-expiry rather than auto-charge-on-expiry because we'd rather a school actively decide to keep using us than discover a charge they didn't expect. The trade-off is that some schools who would have happily paid forget to enter their card and have to come back. We think that's the right trade.

If you'd like to see how this works without committing anything, our 30-day trial is the easiest way in. No card required, no sales call required, and the pricing page tells you the whole story.

[Start a free 30-day trial](https://pickuproster.com/pricing)
