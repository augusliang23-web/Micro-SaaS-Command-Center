# Architecture

```text
src/mockData.ts -> src/App.tsx React state -> dashboard and modal presentation
FeatureDeliveryMatrix -> /api/bridge/extract-features -> Gemini or fabricated fallback
ChatGPTBridgeModal -> /api/bridge/chatgpt-advice -> OpenAI, Gemini, or fabricated fallback
```

There is no persistence, GitHub adapter, Bridge artifact store, feature-flag provider, CI runner, deployment API, authenticated identity, authorization layer, or verified Dev/UAT/Production environment. Both API routes and every provider/fallback path are protected and must not run during onboarding.
