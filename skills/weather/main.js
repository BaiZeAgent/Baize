/**
 * weather skill - 天气查询技能
 * 
 * 使用 Open-Meteo API（免费，无需 API Key）
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
  '重庆': { lat: 29.56, lon: 106.55 },
  'chongqing': { lat: 29.56, lon: 106.55 },
  '天津': { lat: 39.13, lon: 117.20 },
  'tianjin': { lat: 39.13, lon: 117.20 },
  '苏州': { lat: 31.30, lon: 120.62 },
  'suzhou': { lat: 31.30, lon: 120.62 },
  '伦敦': { lat: 51.51, lon: -0.13 },
  'london': { lat: 51.51, lon: -0.13 },
  '纽约': { lat: 40.71, lon: -74.01 },
  'newyork': { lat: 40.71, lon: -74.01 },
  'new york': { lat: 40.71, lon: -74.01 },
  '东京': { lat: 35.68, lon: 139.65 },
  'tokyo': { lat: 35.68, lon: 139.65 },
  '巴黎': { lat: 48.86, lon: 2.35 },
  'paris': { lat: 48.86, lon: 2.35 },
  '悉尼': { lat: -33.87, lon: 151.21 },
  'sydney': { lat: -33.87, lon: 151.21 },
};

// 天气代码描述（WMO 代码）
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

// 风向描述
function getWindDirection(deg) {
  const directions = ['北风', '东北风', '东风', '东南风', '南风', '西南风', '西风', '西北风'];
  const index = Math.round(deg / 45) % 8;
  return directions[index];
}

// 风力等级
function getWindLevel(speed) {
  if (speed < 1) return '无风';
  if (speed < 6) return '微风';
  if (speed < 12) return '轻风';
  if (speed < 20) return '和风';
  if (speed < 29) return '劲风';
  if (speed < 39) return '强风';
  if (speed < 50) return '疾风';
  if (speed < 62) return '大风';
  return '狂风';
}

/**
 * 执行技能
 */
async function main(params) {
  try {
    // 提取位置参数（支持多种参数名）
    const location = params.location || params.city || params.query || params.place || '北京';
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
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current_weather=true&timezone=auto&forecast_days=1`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
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
    const windDesc = getWindDirection(windDir);
    const windLevel = getWindLevel(windSpeed);
    
    // 构建友好的消息
    const message = `📍 ${location}\n` +
      `🌤️ 天气：${weatherDesc}\n` +
      `🌡️ 气温：${temp}°C\n` +
      `💨 风况：${windDesc} ${windSpeed}km/h（${windLevel}）`;
    
    return {
      success: true,
      data: { 
        location,
        temperature: temp,
        weather: weatherDesc,
        weatherCode: current.weathercode,
        windSpeed,
        windDirection: windDir,
        windDesc,
        windLevel,
        isDay: current.is_day,
        time: current.time,
        coords
      },
      message
    };
  } catch (error) {
    return {
      success: false,
      data: {},
      message: `天气查询失败：${error.message}`
    };
  }
}

// 自动执行入口
if (require.main === module) {
  let params = {};
  
  // 从环境变量读取
  if (process.env.BAIZE_PARAMS) {
    try {
      const parsed = JSON.parse(process.env.BAIZE_PARAMS);
      params = parsed.params || parsed;
    } catch (e) {}
  }
  
  // 从命令行参数读取
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
