/**
 * Fontes de dados públicos da UFV Invest — API pública do módulo.
 *
 * Todas as funções rodam no servidor, nunca lançam exceção e devolvem procedência
 * (fonte, URL, horário, live/cache/fallback/error) para cada valor:
 *
 *  - getSolarResource   NASA POWER (climatologia + variabilidade interanual) → fallback embarcado
 *  - getPvgisCrossCheck PVGIS 5.3 (SARAH3 → ERA5)                            → null
 *  - getMarketRates     BCB SGS + Focus + Binance/CoinGecko                   → defaults.ts
 *  - getLocationInfo    IBGE Localidades + SIDRA + Open-Meteo Elevation       → cadastro da usina
 *  - getLiveWeather     Open-Meteo Forecast (7 dias, UTC; hourly.time = fim da hora de média) → null
 *
 * O último parâmetro opcional (`SourceOptions`) permite injetar `fetchImpl`, timeouts e relógio
 * (testes). `clearSourceCache()` esvazia o cache em memória.
 */
export { getSolarResource } from "./nasaPower";
export { getPvgisCrossCheck } from "./pvgis";
export { getMarketRates } from "./market";
export { getLocationInfo } from "./location";
export { getLiveWeather } from "./weather";
export type { LiveWeather, LiveWeatherHour } from "./weather";

export { clearSourceCache, provenance, USER_AGENT } from "./http";
export type { FetchLike, SourceOptions } from "./http";
export {
  compassToOpenMeteoAzimuth,
  compassToPvgisAspect,
  compassToSouthBasedAzimuth,
  southBasedAzimuthToCompass,
  mjToKWh,
} from "./units";
export { CDI_SELIC_SPREAD_PP, DEFAULTS_REVIEWED_AT, MARKET_DEFAULTS } from "./defaults";
