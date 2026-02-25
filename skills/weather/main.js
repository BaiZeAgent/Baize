/**
 * weather skill - 自动生成的跨平台实现
 */

// 城市坐标映射
const CITY_COORDS = {
  '杭州': { lat: 30.25, lon: 120.17 },
  'hangzhou': { lat: 30.25, lon: 120.17 },
  '北京': { lat: 39.90, lon: 116.41 },
  'beijing': { lat: 39.90, lon: 116.41 },
  '上海': { lat: 31.23, lon: 121.47 },
  'shanghai': { lat: 31.23, lon: 121.47 },
  '广州': { lat: 23.13, lon: 113.26 },
  'guangzhou': { lat: 23.13, lon: 113.26 },
  '深圳': { lat: 22.54, lon: 114.06 },
  'shenzhen': { lat: 22.54, lon: 114.06 },
  '成都': { lat: 30.57, lon: 104.07 },
  'chengdu': { lat: 30.57, lon: 104.07 },
  '武汉': { lat: 30.59, lon: 114.31 },
  'wuhan': { lat: 30.59, lon: 114.31 },
  '西安': { lat: 34.34, lon: 108.94 },
  'xian': { lat: 34.34, lon: 108.94 },
  '南京': { lat: 32.06, lon: 118.80 },
  'nanjing': { lat: 32.06, lon: 118.80 },
  '伦敦': { lat: 51.51, lon: -0.13 },
  'london': { lat: 51.51, lon: -0.13 },
  '纽约': { lat: 40.71, lon: -74.01 },
  'newyork': { lat: 40.71, lon: -74.01 },
  '东京': { lat: 35.68, lon: 139.65 },
  'tokyo': { lat: 35.68, lon: 139.65 },
};

// 天气代码描述
const WEATHER_CODES = {
  0: '晴朗',
  1: '大部晴朗', 2: '局部多云', 3: '多云',
  45: '有雾', 48: '雾凇',
  51: '小毛毛雨', 53: '中毛毛雨', 55: '大毛毛雨',
  56: '冻毛毛雨', 57: '大冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  66: '冻雨', 67: '大冻雨',
  71: '小雪', 73: '中雪', 75: '大雪',
  77: '雪粒',
  80: '小阵雨', 81: '中阵雨', 82: '大阵雨',
  85: '小阵雪', 86: '大阵雪',
  95: '雷暴', 96: '雷暴伴小冰雹', 99: '雷暴伴大冰雹',
};

/**
 * 执行技能
 */
async function main(params) {
  try {
    const location = params.location || params.city || params.query || 'Beijing';
    const lat = params.latitude || params.lat;
    const lon = params.longitude || params.lon || params.lng;
    
    // 获取坐标
    let coords;
    if (lat && lon) {
      coords = { lat: parseFloat(lat), lon: parseFloat(lon) };
    } else {
      const cityLower = location.toLowerCase().trim();
      coords = CITY_COORDS[cityLower] || CITY_COORDS[location] || { lat: 39.90, lon: 116.41 };
    }
    
    // 调用 Open-Meteo API
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current_weather=true&timezone=auto&forecast_days=3`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    // 解析天气
    const current = data.current_weather;
    const weatherDesc = WEATHER_CODES[current.weathercode] || '未知';
    const temp = current.temperature;
    const windSpeed = current.windspeed;
    const windDir = current.winddirection;
    
    const result = `${location}: ${weatherDesc}，气温 ${temp}°C，风速 ${windSpeed}km/h`;
    
    return {
      success: true,
      data: { 
        location,
        temperature: temp,
        weather: weatherDesc,
        windSpeed,
        windDirection: windDir,
        raw: data
      },
      message: result
    };
  } catch (error) {
    return {
      success: false,
      data: {},
      message: error.message
    };
  }
}

// 自动执行
if (require.main === module) {
  let params = {};
  if (process.env.BAIZE_PARAMS) {
    try {
      const parsed = JSON.parse(process.env.BAIZE_PARAMS);
      params = parsed.params || parsed;
    } catch (e) {}
  }
  if (process.argv.length > 2) {
    try {
      params = JSON.parse(process.argv[2]);
    } catch (e) {
      params = { location: process.argv[2] };
    }
  }
  main(params).then(result => {
    console.log(JSON.stringify(result));
    process.exit(result.success ? 0 : 1);
  }).catch(error => {
    console.log(JSON.stringify({ success: false, message: error.message }));
    process.exit(1);
  });
}

module.exports = { main };
