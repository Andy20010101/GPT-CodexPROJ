# Project Brief

## One-Sentence Definition
A lightweight API-first service that fills the current gap in SKU-level inventory-cycle and sales analysis, using ERP APIs as the core source boundary without expanding into broad system integration or a data platform.

## Primary Actor
Ecommerce operations as the primary business actor, with leadership as a secondary consumer of the resulting metrics.

## Core Problem
The current ERP and related internal tooling do not provide the needed SKU-level inventory-cycle and sales analysis directly, so business users cannot reliably consume current inventory, default-local-warehouse quantity, outbound, turnover, and time-window sales metrics in one bounded service.

## Primary Flow
An internal consumer system or frontend calls the service API to retrieve SKU-level inventory and sales analysis derived from ERP APIs, including time-dimension metrics aligned across multiple ERP endpoints when needed.

## Why This Matters Now
The immediate need is to close a concrete SKU-level analysis gap with a narrow, fast-to-deliver service instead of starting a broader WMS/internal-system sync effort or building a general-purpose data platform first.
