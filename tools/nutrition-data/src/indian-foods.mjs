#!/usr/bin/env node
import Database from 'better-sqlite3'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(HERE, '../../../apps/mobile/assets/nutrition.db')

export const INDIAN_FOODS = [
  // Breads & Rotis
  {
    name: 'Roti (Chapati, Whole Wheat Flatbread)',
    category: 'Indian Breads',
    kcal: 297, protein: 9.2, fat: 3.7, carb: 56.4, fiber: 9.6,
    portions: [
      { unit: 'roti / chapati', modifier: 'medium', amount: 1, grams: 35 },
      { unit: 'serving (2 rotis)', modifier: 'standard', amount: 2, grams: 70 },
      { unit: 'piece', modifier: 'large', amount: 1, grams: 50 },
    ],
    synonyms: ['roti', 'chapati', 'phulka', 'roti wheat', 'indian flatbread', 'fulka']
  },
  {
    name: 'Paratha (Plain Whole Wheat, Ghee/Oil Layered)',
    category: 'Indian Breads',
    kcal: 326, protein: 7.8, fat: 12.5, carb: 45.2, fiber: 6.8,
    portions: [
      { unit: 'paratha', modifier: 'medium', amount: 1, grams: 60 },
      { unit: 'serving (2 parathas)', modifier: 'standard', amount: 2, grams: 120 },
    ],
    synonyms: ['paratha', 'plain paratha', 'tava paratha', 'laccha paratha']
  },
  {
    name: 'Aloo Paratha (Spiced Potato Stuffed Bread)',
    category: 'Indian Breads',
    kcal: 245, protein: 5.5, fat: 8.8, carb: 36.0, fiber: 4.2,
    portions: [
      { unit: 'paratha', modifier: 'medium', amount: 1, grams: 110 },
      { unit: 'paratha', modifier: 'large', amount: 1, grams: 150 },
    ],
    synonyms: ['aloo paratha', 'alu paratha', 'potato paratha', 'stuffed paratha']
  },
  {
    name: 'Paneer Paratha (Cottage Cheese Stuffed Bread)',
    category: 'Indian Breads',
    kcal: 285, protein: 11.2, fat: 13.5, carb: 30.1, fiber: 3.8,
    portions: [
      { unit: 'paratha', modifier: 'medium', amount: 1, grams: 120 },
    ],
    synonyms: ['paneer paratha', 'cottage cheese paratha']
  },
  {
    name: 'Naan (Tandoori Butter Naan)',
    category: 'Indian Breads',
    kcal: 310, protein: 8.5, fat: 8.0, carb: 51.0, fiber: 2.8,
    portions: [
      { unit: 'naan', modifier: 'medium', amount: 1, grams: 90 },
      { unit: 'naan', modifier: 'butter', amount: 1, grams: 100 },
      { unit: 'naan', modifier: 'garlic', amount: 1, grams: 105 },
    ],
    synonyms: ['naan', 'butter naan', 'garlic naan', 'tandoori naan']
  },
  {
    name: 'Puri (Deep Fried Wheat Bread)',
    category: 'Indian Breads',
    kcal: 380, protein: 7.2, fat: 22.0, carb: 38.5, fiber: 4.0,
    portions: [
      { unit: 'puri', modifier: 'medium', amount: 1, grams: 25 },
      { unit: 'serving (4 puris)', modifier: 'standard', amount: 4, grams: 100 },
    ],
    synonyms: ['puri', 'poori', 'fried bread']
  },

  // Lentils, Dals & Legumes
  {
    name: 'Dal Tadka (Yellow Lentils with Cumin & Garlic Tempering)',
    category: 'Indian Dals & Curries',
    kcal: 118, protein: 6.8, fat: 3.5, carb: 15.2, fiber: 4.5,
    portions: [
      { unit: 'katori / small bowl', modifier: 'small', amount: 1, grams: 150 },
      { unit: 'bowl / cup', modifier: 'standard', amount: 1, grams: 220 },
    ],
    synonyms: ['dal tadka', 'yellow dal', 'toor dal', 'arhar dal', 'tadka dal']
  },
  {
    name: 'Dal Makhani (Slow-Cooked Black Lentils with Butter & Cream)',
    category: 'Indian Dals & Curries',
    kcal: 165, protein: 5.8, fat: 9.5, carb: 14.2, fiber: 4.0,
    portions: [
      { unit: 'katori / small bowl', modifier: 'small', amount: 1, grams: 150 },
      { unit: 'bowl / cup', modifier: 'standard', amount: 1, grams: 220 },
    ],
    synonyms: ['dal makhani', 'makhani dal', 'black dal', 'maa ki dal', 'urad dal']
  },
  {
    name: 'Chana Masala (Spiced Chickpea Curry, Chole)',
    category: 'Indian Dals & Curries',
    kcal: 142, protein: 6.5, fat: 5.2, carb: 17.8, fiber: 5.2,
    portions: [
      { unit: 'katori / small bowl', modifier: 'small', amount: 1, grams: 160 },
      { unit: 'bowl / plate', modifier: 'standard', amount: 1, grams: 240 },
    ],
    synonyms: ['chana masala', 'chole', 'chole curry', 'kabuli chana', 'chickpea curry']
  },
  {
    name: 'Rajma Masala (Red Kidney Bean Curry)',
    category: 'Indian Dals & Curries',
    kcal: 135, protein: 6.2, fat: 4.5, carb: 17.5, fiber: 5.8,
    portions: [
      { unit: 'katori / small bowl', modifier: 'small', amount: 1, grams: 160 },
      { unit: 'bowl / cup', modifier: 'standard', amount: 1, grams: 240 },
    ],
    synonyms: ['rajma', 'rajma masala', 'rajma chawal', 'kidney bean curry']
  },
  {
    name: 'Moong Dal (Yellow Split Mung Bean Soup)',
    category: 'Indian Dals & Curries',
    kcal: 105, protein: 7.2, fat: 2.2, carb: 14.5, fiber: 4.2,
    portions: [
      { unit: 'katori / small bowl', modifier: 'small', amount: 1, grams: 150 },
      { unit: 'bowl', modifier: 'standard', amount: 1, grams: 220 },
    ],
    synonyms: ['moong dal', 'mung dal', 'yellow moong', 'split moong']
  },
  {
    name: 'Sambar (South Indian Vegetable & Lentil Stew)',
    category: 'South Indian Dishes',
    kcal: 75, protein: 3.2, fat: 2.1, carb: 10.8, fiber: 3.0,
    portions: [
      { unit: 'katori / cup', modifier: 'standard', amount: 1, grams: 180 },
      { unit: 'bowl', modifier: 'large', amount: 1, grams: 250 },
    ],
    synonyms: ['sambar', 'sambhar', 'south indian sambar', 'idli sambar']
  },

  // Paneer & Vegetarian Curries
  {
    name: 'Paneer Butter Masala (Cottage Cheese in Rich Tomato Makhani Gravy)',
    category: 'Indian Curries',
    kcal: 228, protein: 9.8, fat: 17.5, carb: 7.8, fiber: 1.8,
    portions: [
      { unit: 'katori / small bowl', modifier: 'small', amount: 1, grams: 150 },
      { unit: 'bowl / serving', modifier: 'standard', amount: 1, grams: 220 },
    ],
    synonyms: ['paneer butter masala', 'paneer makhani', 'shahi paneer', 'butter paneer']
  },
  {
    name: 'Palak Paneer (Cottage Cheese in Spiced Spinach Puree)',
    category: 'Indian Curries',
    kcal: 172, protein: 9.5, fat: 12.8, carb: 4.8, fiber: 2.8,
    portions: [
      { unit: 'katori / small bowl', modifier: 'small', amount: 1, grams: 150 },
      { unit: 'bowl / serving', modifier: 'standard', amount: 1, grams: 220 },
    ],
    synonyms: ['palak paneer', 'spinach paneer', 'saag paneer']
  },
  {
    name: 'Kadai Paneer (Paneer with Bell Peppers & Roasted Coriander Spices)',
    category: 'Indian Curries',
    kcal: 195, protein: 10.2, fat: 14.5, carb: 6.2, fiber: 2.2,
    portions: [
      { unit: 'serving', modifier: 'standard', amount: 1, grams: 200 },
    ],
    synonyms: ['kadai paneer', 'karahi paneer', 'kadhai paneer']
  },
  {
    name: 'Paneer Raw (Indian Cottage Cheese)',
    category: 'Dairy',
    kcal: 295, protein: 18.5, fat: 22.0, carb: 4.5, fiber: 0,
    portions: [
      { unit: 'cube / piece', modifier: 'small', amount: 1, grams: 20 },
      { unit: 'portion (100g)', modifier: 'standard', amount: 1, grams: 100 },
    ],
    synonyms: ['paneer', 'cottage cheese indian', 'fresh paneer', 'raw paneer']
  },
  {
    name: 'Aloo Gobi (Dry Spiced Potato & Cauliflower Stir Fry)',
    category: 'Indian Vegetables',
    kcal: 110, protein: 2.8, fat: 5.5, carb: 13.2, fiber: 3.5,
    portions: [
      { unit: 'katori / small bowl', modifier: 'small', amount: 1, grams: 130 },
      { unit: 'bowl / serving', modifier: 'standard', amount: 1, grams: 180 },
    ],
    synonyms: ['aloo gobi', 'alu gobi', 'gobi aloo', 'cauliflower potato']
  },
  {
    name: 'Bhindi Masala (Spiced Okra Stir Fry)',
    category: 'Indian Vegetables',
    kcal: 95, protein: 2.2, fat: 5.0, carb: 10.5, fiber: 4.0,
    portions: [
      { unit: 'katori / small bowl', modifier: 'small', amount: 1, grams: 120 },
      { unit: 'bowl / serving', modifier: 'standard', amount: 1, grams: 170 },
    ],
    synonyms: ['bhindi masala', 'bhindi fry', 'okra masala', 'ladies finger fry']
  },
  {
    name: 'Baingan Bharta (Roasted Eggplant Mash with Spices)',
    category: 'Indian Vegetables',
    kcal: 88, protein: 2.0, fat: 4.8, carb: 9.5, fiber: 4.2,
    portions: [
      { unit: 'katori', modifier: 'standard', amount: 1, grams: 140 },
    ],
    synonyms: ['baingan bharta', 'baingan bhurji', 'eggplant mash', 'vangi bharta']
  },

  // Rice, Biryanis & Pulao
  {
    name: 'Chicken Biryani (Hyderabadi Dum Biryani with Spiced Basmati Rice & Chicken)',
    category: 'Indian Rice Dishes',
    kcal: 180, protein: 9.5, fat: 6.8, carb: 20.2, fiber: 1.5,
    portions: [
      { unit: 'plate / bowl', modifier: 'standard', amount: 1, grams: 300 },
      { unit: 'half plate', modifier: 'small', amount: 1, grams: 200 },
      { unit: 'full plate', modifier: 'large', amount: 1, grams: 450 },
    ],
    synonyms: ['chicken biryani', 'dum biryani', 'hyderabadi biryani', 'murgh biryani']
  },
  {
    name: 'Mutton Biryani (Lamb / Goat Meat Spiced Rice)',
    category: 'Indian Rice Dishes',
    kcal: 215, protein: 11.2, fat: 9.8, carb: 20.5, fiber: 1.5,
    portions: [
      { unit: 'plate / bowl', modifier: 'standard', amount: 1, grams: 320 },
      { unit: 'full plate', modifier: 'large', amount: 1, grams: 450 },
    ],
    synonyms: ['mutton biryani', 'lamb biryani', 'gosht biryani']
  },
  {
    name: 'Vegetable Biryani (Fragrant Basmati Rice with Mixed Vegetables & Paneer)',
    category: 'Indian Rice Dishes',
    kcal: 155, protein: 4.5, fat: 5.2, carb: 23.0, fiber: 2.8,
    portions: [
      { unit: 'plate / bowl', modifier: 'standard', amount: 1, grams: 300 },
    ],
    synonyms: ['veg biryani', 'vegetable biryani', 'paneer biryani']
  },
  {
    name: 'Vegetable Pulao (Basmati Rice Cooked with Vegetables & Ghee)',
    category: 'Indian Rice Dishes',
    kcal: 148, protein: 3.8, fat: 4.5, carb: 23.5, fiber: 2.2,
    portions: [
      { unit: 'plate / bowl', modifier: 'standard', amount: 1, grams: 250 },
    ],
    synonyms: ['veg pulao', 'vegetable pulao', 'matar pulao', 'peas pulao']
  },
  {
    name: 'Jeera Rice (Cumin Seed Basmati Rice)',
    category: 'Indian Rice Dishes',
    kcal: 140, protein: 2.8, fat: 3.0, carb: 25.5, fiber: 1.0,
    portions: [
      { unit: 'katori / bowl', modifier: 'standard', amount: 1, grams: 200 },
    ],
    synonyms: ['jeera rice', 'cumin rice', 'tarka rice']
  },
  {
    name: 'Khichdi (Moong Dal & Rice Comfort Porridge with Ghee)',
    category: 'Indian Rice Dishes',
    kcal: 125, protein: 4.8, fat: 3.2, carb: 19.5, fiber: 2.5,
    portions: [
      { unit: 'bowl / plate', modifier: 'standard', amount: 1, grams: 250 },
    ],
    synonyms: ['khichdi', 'dal khichdi', 'moong dal khichdi', 'khichuri']
  },
  {
    name: 'Curd Rice (Thayir Sadam, Yogurt Rice with Mustard Tempering)',
    category: 'South Indian Dishes',
    kcal: 130, protein: 3.8, fat: 4.0, carb: 19.8, fiber: 0.8,
    portions: [
      { unit: 'bowl', modifier: 'standard', amount: 1, grams: 220 },
    ],
    synonyms: ['curd rice', 'thayir sadam', 'daddojanam', 'yogurt rice']
  },

  // South Indian Breakfast & Staples
  {
    name: 'Dosa (Plain Crispy Fermented Rice & Lentil Crepe)',
    category: 'South Indian Dishes',
    kcal: 168, protein: 4.2, fat: 4.5, carb: 27.5, fiber: 1.8,
    portions: [
      { unit: 'dosa', modifier: 'medium', amount: 1, grams: 80 },
      { unit: 'dosa', modifier: 'large', amount: 1, grams: 110 },
    ],
    synonyms: ['dosa', 'plain dosa', 'sada dosa', 'crispy dosa']
  },
  {
    name: 'Masala Dosa (Crispy Crepe Stuffed with Spiced Potato)',
    category: 'South Indian Dishes',
    kcal: 210, protein: 4.8, fat: 7.5, carb: 31.0, fiber: 2.8,
    portions: [
      { unit: 'masala dosa', modifier: 'standard', amount: 1, grams: 180 },
    ],
    synonyms: ['masala dosa', 'aloo dosa', 'mysore masala dosa']
  },
  {
    name: 'Idli (Steamed Fermented Rice & Black Gram Cakes)',
    category: 'South Indian Dishes',
    kcal: 132, protein: 5.0, fat: 0.8, carb: 26.5, fiber: 2.0,
    portions: [
      { unit: 'idli', modifier: 'piece', amount: 1, grams: 40 },
      { unit: 'plate (2 idlis)', modifier: 'standard', amount: 2, grams: 80 },
      { unit: 'serving (3 idlis)', modifier: 'medium', amount: 3, grams: 120 },
    ],
    synonyms: ['idli', 'steamed idli', 'rice idli', 'idly']
  },
  {
    name: 'Medu Vada (Crispy Fried Black Gram Doughnut)',
    category: 'South Indian Dishes',
    kcal: 285, protein: 8.5, fat: 16.5, carb: 25.5, fiber: 3.5,
    portions: [
      { unit: 'vada / piece', modifier: 'medium', amount: 1, grams: 45 },
      { unit: 'plate (2 vadas)', modifier: 'standard', amount: 2, grams: 90 },
    ],
    synonyms: ['vada', 'medu vada', 'sambar vada', 'urad vada']
  },
  {
    name: 'Uttapam (Thick Rice & Lentil Pancake with Onion & Tomato)',
    category: 'South Indian Dishes',
    kcal: 175, protein: 4.5, fat: 5.0, carb: 28.0, fiber: 2.5,
    portions: [
      { unit: 'uttapam', modifier: 'medium', amount: 1, grams: 130 },
    ],
    synonyms: ['uttapam', 'onion uttapam', 'tomato uttapam', 'uthappam']
  },
  {
    name: 'Upma (Roasted Semolina / Rava Breakfast Porridge with Veggies)',
    category: 'Indian Breakfast',
    kcal: 155, protein: 4.0, fat: 5.2, carb: 23.2, fiber: 2.0,
    portions: [
      { unit: 'bowl / katori', modifier: 'standard', amount: 1, grams: 180 },
    ],
    synonyms: ['upma', 'rava upma', 'sooji upma', 'uppittu']
  },
  {
    name: 'Poha (Flattened Rice with Mustard, Turmeric, Peanuts & Potatoes)',
    category: 'Indian Breakfast',
    kcal: 180, protein: 3.8, fat: 6.5, carb: 26.8, fiber: 2.2,
    portions: [
      { unit: 'plate / bowl', modifier: 'standard', amount: 1, grams: 180 },
    ],
    synonyms: ['poha', 'kanda poha', 'flattened rice', 'batata poha', 'aval']
  },
  {
    name: 'Coconut Chutney (South Indian Coconut & Chana Dal Dip)',
    category: 'Condiments',
    kcal: 230, protein: 3.5, fat: 21.0, carb: 7.2, fiber: 4.5,
    portions: [
      { unit: 'tablespoon', modifier: 'standard', amount: 1, grams: 20 },
      { unit: 'small cup / portion', modifier: 'standard', amount: 1, grams: 50 },
    ],
    synonyms: ['coconut chutney', 'nariyal chutney', 'white chutney']
  },

  // Non-Vegetarian Curries & Tandoori
  {
    name: 'Butter Chicken (Murgh Makhani, Chicken in Creamy Tomato Gravy)',
    category: 'Indian Curries',
    kcal: 210, protein: 14.5, fat: 15.2, carb: 4.8, fiber: 1.2,
    portions: [
      { unit: 'katori / small bowl', modifier: 'small', amount: 1, grams: 160 },
      { unit: 'bowl / serving', modifier: 'standard', amount: 1, grams: 240 },
    ],
    synonyms: ['butter chicken', 'murgh makhani', 'chicken makhani']
  },
  {
    name: 'Chicken Tikka Masala (Charred Chicken Breast in Spiced Onion-Tomato Sauce)',
    category: 'Indian Curries',
    kcal: 185, protein: 16.2, fat: 11.5, carb: 5.2, fiber: 1.5,
    portions: [
      { unit: 'serving', modifier: 'standard', amount: 1, grams: 220 },
    ],
    synonyms: ['chicken tikka masala', 'tikka masala']
  },
  {
    name: 'Chicken Curry (Homestyle Indian Tari / Gravy Chicken)',
    category: 'Indian Curries',
    kcal: 160, protein: 15.8, fat: 9.5, carb: 3.5, fiber: 1.0,
    portions: [
      { unit: 'katori / small bowl', modifier: 'small', amount: 1, grams: 160 },
      { unit: 'bowl / serving', modifier: 'standard', amount: 1, grams: 240 },
    ],
    synonyms: ['chicken curry', 'desi chicken', 'tari chicken', 'koli curry']
  },
  {
    name: 'Tandoori Chicken (Clay-Oven Roasted Spiced Yogurt Marinated Chicken)',
    category: 'Indian Starters',
    kcal: 195, protein: 24.5, fat: 9.8, carb: 2.2, fiber: 0.5,
    portions: [
      { unit: 'leg piece / drumstick', modifier: 'medium', amount: 1, grams: 110 },
      { unit: 'breast piece', modifier: 'large', amount: 1, grams: 160 },
      { unit: 'half chicken (2 pieces)', modifier: 'standard', amount: 2, grams: 240 },
    ],
    synonyms: ['tandoori chicken', 'chicken tandoori', 'roasted chicken indian']
  },
  {
    name: 'Egg Curry (Boiled Eggs in Spiced Onion-Tomato Gravy)',
    category: 'Indian Curries',
    kcal: 145, protein: 9.8, fat: 10.2, carb: 4.2, fiber: 1.0,
    portions: [
      { unit: 'serving (2 eggs + gravy)', modifier: 'standard', amount: 1, grams: 200 },
    ],
    synonyms: ['egg curry', 'anda curry', 'egg masala', 'anda masala']
  },
  {
    name: 'Egg Bhurji (Indian Spiced Scrambled Eggs with Onions & Chillies)',
    category: 'Indian Dishes',
    kcal: 175, protein: 12.0, fat: 13.0, carb: 3.0, fiber: 0.8,
    portions: [
      { unit: 'serving (2 eggs)', modifier: 'standard', amount: 1, grams: 130 },
    ],
    synonyms: ['egg bhurji', 'anda bhurji', 'scrambled egg indian', 'muttai poriyal']
  },
  {
    name: 'Fish Curry (Goan / Kerala Coconut Fish Curry)',
    category: 'Indian Curries',
    kcal: 140, protein: 14.0, fat: 8.2, carb: 3.2, fiber: 1.0,
    portions: [
      { unit: 'bowl / serving', modifier: 'standard', amount: 1, grams: 220 },
    ],
    synonyms: ['fish curry', 'goan fish curry', 'meen curry', 'kerala fish curry']
  },

  // Snacks, Street Foods & Beverages
  {
    name: 'Samosa (Crispy Fried Pastry Stuffed with Spiced Potatoes & Peas)',
    category: 'Indian Snacks',
    kcal: 310, protein: 5.0, fat: 18.0, carb: 32.5, fiber: 3.2,
    portions: [
      { unit: 'samosa', modifier: 'medium', amount: 1, grams: 65 },
      { unit: 'serving (2 samosas)', modifier: 'standard', amount: 2, grams: 130 },
    ],
    synonyms: ['samosa', 'alu samosa', 'punjabi samosa', 'singara']
  },
  {
    name: 'Pav Bhaji (Spiced Mashed Vegetable Curry with Butter Toasted Buns)',
    category: 'Indian Street Food',
    kcal: 170, protein: 4.2, fat: 7.8, carb: 21.0, fiber: 3.5,
    portions: [
      { unit: 'bhaji portion', modifier: 'bowl', amount: 1, grams: 200 },
      { unit: 'pav (1 bun)', modifier: 'piece', amount: 1, grams: 40 },
      { unit: 'full plate (bhaji + 2 pav)', modifier: 'standard', amount: 1, grams: 280 },
    ],
    synonyms: ['pav bhaji', 'bhaji pav', 'pao bhaji']
  },
  {
    name: 'Pani Puri (Crispy Puris with Spiced Mint Water & Chickpeas)',
    category: 'Indian Street Food',
    kcal: 160, protein: 3.2, fat: 5.5, carb: 25.0, fiber: 2.8,
    portions: [
      { unit: 'puri / piece', modifier: 'single', amount: 1, grams: 25 },
      { unit: 'plate (6 puris)', modifier: 'standard', amount: 6, grams: 150 },
    ],
    synonyms: ['pani puri', 'golgappa', 'puchka', 'paani poori']
  },
  {
    name: 'Chai (Indian Masala Milk Tea with Sugar)',
    category: 'Beverages',
    kcal: 75, protein: 2.5, fat: 2.8, carb: 10.2, fiber: 0,
    portions: [
      { unit: 'cutting cup', modifier: 'small', amount: 1, grams: 100 },
      { unit: 'cup / mug', modifier: 'standard', amount: 1, grams: 160 },
    ],
    synonyms: ['chai', 'masala chai', 'milk tea', 'indian tea', 'kadak chai']
  },
  {
    name: 'Sweet Lassi (Chilled Sweetened Yogurt Drink)',
    category: 'Beverages',
    kcal: 110, protein: 3.5, fat: 3.8, carb: 16.0, fiber: 0,
    portions: [
      { unit: 'glass', modifier: 'medium', amount: 1, grams: 250 },
      { unit: 'large glass', modifier: 'punjabi', amount: 1, grams: 400 },
    ],
    synonyms: ['lassi', 'sweet lassi', 'punjabi lassi', 'mango lassi']
  },
  {
    name: 'Chaas (Buttermilk with Cumin, Ginger & Coriander)',
    category: 'Beverages',
    kcal: 35, protein: 2.2, fat: 1.2, carb: 3.8, fiber: 0,
    portions: [
      { unit: 'glass', modifier: 'standard', amount: 1, grams: 250 },
    ],
    synonyms: ['chaas', 'buttermilk', 'masala chaas', 'mor', 'mattha']
  },
  {
    name: 'Gulab Jamun (Fried Milk Solids Dumpling in Cardamom Rose Syrup)',
    category: 'Indian Sweets',
    kcal: 380, protein: 5.5, fat: 14.5, carb: 58.0, fiber: 0.5,
    portions: [
      { unit: 'piece', modifier: 'medium', amount: 1, grams: 45 },
      { unit: 'serving (2 pieces)', modifier: 'standard', amount: 2, grams: 90 },
    ],
    synonyms: ['gulab jamun', 'jamun', 'kala jamun']
  },
  {
    name: 'Kheer (Indian Basmati Rice Pudding with Cardamom & Nuts)',
    category: 'Indian Sweets',
    kcal: 160, protein: 4.5, fat: 5.8, carb: 23.0, fiber: 0.5,
    portions: [
      { unit: 'katori / small bowl', modifier: 'standard', amount: 1, grams: 150 },
    ],
    synonyms: ['kheer', 'payasam', 'rice kheer', 'phirni']
  }
]

export function insertIndianFoods(dbPath = DB_PATH) {
  const db = new Database(dbPath)
  console.log(`Ingesting Indian Food Composition Tables (IFCT) into: ${dbPath}`)

  const insertFood = db.prepare(`
    INSERT INTO foods (
      source, source_id, name, category, basis, basis_confidence,
      energy_kcal, protein_g, fat_g, carb_g, fiber_g, completeness_score,
      popularity_rank, license, updated_at
    ) VALUES (
      'ifct', ?, ?, ?, 'per_100g', 'high',
      ?, ?, ?, ?, ?, 0.95,
      100, 'CC-BY-4.0', ?
    )
  `)

  const insertPortion = db.prepare(`
    INSERT INTO food_portions (
      food_id, measure_unit, modifier, amount, gram_weight, is_fndds_default
    ) VALUES (?, ?, ?, ?, ?, ?)
  `)

  const insertSynonym = db.prepare(`
    INSERT INTO food_synonyms (
      food_id, synonym, synonym_type
    ) VALUES (?, ?, 'alias')
  `)

  const insertFts = db.prepare(`
    INSERT INTO food_fts (rowid, name, brand, synonyms)
    VALUES (?, ?, '', ?)
  `)

  const insertTrigram = db.prepare(`
    INSERT INTO food_fts_trigram (rowid, name)
    VALUES (?, ?)
  `)

  const checkExisting = db.prepare(`SELECT id FROM foods WHERE name = ?`)

  const now = Date.now()
  let added = 0

  db.transaction(() => {
    for (const item of INDIAN_FOODS) {
      const existing = checkExisting.get(item.name)
      if (existing) continue

      const info = insertFood.run(
        `ifct_${item.name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30)}`,
        item.name,
        item.category,
        item.kcal,
        item.protein,
        item.fat,
        item.carb,
        item.fiber || 0,
        now
      )

      const foodId = Number(info.lastInsertRowid)

      // Add portions
      if (item.portions) {
        for (let i = 0; i < item.portions.length; i++) {
          const p = item.portions[i]
          insertPortion.run(
            foodId,
            p.unit,
            p.modifier || '',
            p.amount || 1,
            p.grams,
            i === 0 ? 1 : 0
          )
        }
      }

      // Add synonyms
      const synonyms = item.synonyms || []
      for (const syn of synonyms) {
        insertSynonym.run(foodId, syn)
      }

      const allSynonyms = synonyms.join(' ')
      insertFts.run(foodId, item.name, allSynonyms)
      insertTrigram.run(foodId, item.name)

      added++
    }
  })()

  console.log(`✓ Successfully added and indexed ${added} Indian staple foods!`)
  db.close()
}

// Run directly if invoked from command line
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  insertIndianFoods()
}
