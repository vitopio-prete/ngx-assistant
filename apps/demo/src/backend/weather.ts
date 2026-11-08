const CONDITIONS = ['sunny', 'cloudy', 'rainy', 'windy', 'foggy'];

/** The same city always gets the same weather. */
export function forecastFor(city: string) {
  let hash = 0;
  for (const char of city.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { city, temperature: 5 + (hash % 25), condition: CONDITIONS[hash % CONDITIONS.length] };
}
