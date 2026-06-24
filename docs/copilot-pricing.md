# Copilot Pricing

## Pricing tables

All prices are **per 1 million tokens**.

### OpenAI

> \[!NOTE] Models with a **Long context** tier, offer extended capabilities and longer context windows. See [Supported AI models in GitHub Copilot](/en/copilot/reference/ai-models/supported-models#models-with-extended-capabilities)

| Model         | Release status | Category    | Tier         | Threshold (input tokens) |  Input | Cached input | Output |
| ------------- | -------------- | ----------- | ------------ | ------------------------ | -----: | -----------: | -----: |
| GPT-5 mini    | GA             | Lightweight | Default      | Not applicable           |  $0.25 |       $0.025 |  $2.00 |
| GPT-5.3-Codex | GA             | Powerful    | Default      | Not applicable           |  $1.75 |       $0.175 | $14.00 |
| GPT-5.4       | GA             | Versatile   | Default      | ≤ 272K                   |  $2.50 |        $0.25 | $15.00 |
| GPT-5.4       | GA             | Versatile   | Long context | > 272K                   |  $5.00 |        $0.50 | $22.50 |
| GPT-5.4 mini  | GA             | Lightweight | Default      | Not applicable           |  $0.75 |       $0.075 |  $4.50 |
| GPT-5.4 nano  | GA             | Lightweight | Default      | Not applicable           |  $0.20 |        $0.02 |  $1.25 |
| GPT-5.5       | GA             | Powerful    | Default      | ≤ 272K                   |  $5.00 |        $0.50 | $30.00 |
| GPT-5.5       | GA             | Powerful    | Long context | > 272K                   | $10.00 |        $1.00 | $45.00 |

### Anthropic

Anthropic models include a cache write cost in addition to cached input.

> \[!NOTE] Claude Fable 5 is currently unavailable. For more information, see [Anthropic's announcement](https://www.anthropic.com/news/fable-mythos-access).

| Model             | Release status | Category  |  Input | Cached input | Cache write | Output |
| ----------------- | -------------- | --------- | -----: | -----------: | ----------: | -----: |
| Claude Haiku 4.5  | GA             | Versatile |  $1.00 |        $0.10 |       $1.25 |  $5.00 |
| Claude Sonnet 4   | GA             | Versatile |  $3.00 |        $0.30 |       $3.75 | $15.00 |
| Claude Sonnet 4.5 | GA             | Versatile |  $3.00 |        $0.30 |       $3.75 | $15.00 |
| Claude Sonnet 4.6 | GA             | Versatile |  $3.00 |        $0.30 |       $3.75 | $15.00 |
| Claude Opus 4.5   | GA             | Powerful  |  $5.00 |        $0.50 |       $6.25 | $25.00 |
| Claude Opus 4.6   | GA             | Powerful  |  $5.00 |        $0.50 |       $6.25 | $25.00 |
| Claude Opus 4.7   | GA             | Powerful  |  $5.00 |        $0.50 |       $6.25 | $25.00 |
| Claude Opus 4.8   | GA             | Powerful  |  $5.00 |        $0.50 |       $6.25 | $25.00 |
| Claude Fable 5    | GA             | Powerful  | $10.00 |        $1.00 |      $12.50 | $50.00 |

### Google

> \[!NOTE] Models with a **Long context** tier, offer extended capabilities and longer context windows. See [Supported AI models in GitHub Copilot](/en/copilot/reference/ai-models/supported-models#models-with-extended-capabilities)

| Model            | Release status | Category    | Tier         | Threshold (input tokens) | Input | Cached input | Output |
| ---------------- | -------------- | ----------- | ------------ | ------------------------ | ----: | -----------: | -----: |
| Gemini 2.5 Pro   | GA             | Powerful    | Default      | Not applicable           | $1.25 |       $0.125 | $10.00 |
| Gemini 3 Flash   | Public preview | Lightweight | Default      | Not applicable           | $0.50 |        $0.05 |  $3.00 |
| Gemini 3.1 Pro   | Public preview | Powerful    | Default      | ≤ 200K                   | $2.00 |        $0.20 | $12.00 |
| Gemini 3.1 Pro   | Public preview | Powerful    | Long context | > 200K                   | $4.00 |        $0.40 | $18.00 |
| Gemini 3.5 Flash | GA             | Lightweight | Default      | Not applicable           | $1.50 |        $0.15 |  $9.00 |

### Fine-tuned (GitHub)

| Model       | Release status | Category  | Input | Cached input | Output |
| ----------- | -------------- | --------- | ----: | -----------: | -----: |
| Raptor mini | Public preview | Versatile | $0.25 |       $0.025 |  $2.00 |

### Microsoft

| Model            | Release status | Category    | Input | Cached input | Output |
| ---------------- | -------------- | ----------- | ----: | -----------: | -----: |
| MAI-Code-1-Flash | GA             | Lightweight | $0.75 |       $0.075 |  $4.50 |
