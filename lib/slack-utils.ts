/**
 * Map of Slack emoji shortcodes to unicode emoji characters.
 */
const EMOJI_MAP: Record<string, string> = {
  "smile": "😄", "smiley": "😃", "grinning": "😀", "blush": "😊", "slight_smile": "🙂",
  "wink": "😉", "heart_eyes": "😍", "kissing_heart": "😘", "kissing": "😗",
  "kissing_smiling_eyes": "😙", "kissing_closed_eyes": "😚", "stuck_out_tongue_winking_eye": "😜",
  "stuck_out_tongue_closed_eyes": "😝", "stuck_out_tongue": "😛", "joy": "😂",
  "laughing": "😆", "sweat_smile": "😅", "rofl": "🤣", "relaxed": "☺️",
  "innocent": "😇", "sunglasses": "😎", "nerd": "🤓", "thinking": "🤔",
  "confused": "😕", "neutral": "😐", "expressionless": "😑", "no_mouth": "😶",
  "grimacing": "😬", "worried": "😟", "frowning": "😦", "anguished": "😧",
  "open_mouth": "😮", "hushed": "😯", "astonished": "😲", "sweat": "😓",
  "disappointed": "😞", "pensive": "😔", "persevere": "😣", "confounded": "😖",
  "tired": "😫", "weary": "😩", "pleading": "🥺", "sob": "😭", "cry": "😢",
  "scream": "😱", "fearful": "😨", "cold_sweat": "😰", "disappointed_relieved": "😥",
  "relieved": "😌", "sleepy": "😪", "sleeping": "😴", "mask": "😷",
  "face_with_thermometer": "🤒", "face_with_head_bandage": "🤕", "nauseated": "🤢",
  "vomiting": "🤮", "sneezing": "🤧", "hot": "🥵", "cold": "🥶", "woozy": "🥴",
  "dizzy": "💫", "star_struck": "🤩", "partying": "🥳", "monocle": "🧐",
  "unamused": "😒", "flushed": "😳", "zipper_mouth": "🤐", "lying": "🤥",
  "shushing": "🤫", "hand_over_mouth": "🤭", "yawning": "🥱", "rolling_eyes": "🙄",
  "triumph": "😤", "rage": "😡", "angry": "😠", "smiling_imp": "😈", "imp": "👿",
  "skull": "💀", "skull_and_crossbones": "☠️", "poop": "💩", "clown": "🤡",
  "ogre": "👹", "goblin": "👺", "ghost": "👻", "alien": "👽", "robot": "🤖",
  "wave": "👋", "raised_hand": "✋", "spock": "🖖", "ok_hand": "👌",
  "pinched_fingers": "🤌", "pinching": "🤏", "crossed_fingers": "🤞",
  "love_you": "🤟", "metal": "🤘", "call_me": "🤙", "point_left": "👈",
  "point_right": "👉", "point_up": "☝️", "point_down": "👇", "point_up_2": "👆",
  "fist": "✊", "punch": "👊", "left_facing_fist": "🤛", "right_facing_fist": "🤜",
  "clap": "👏", "raised_hands": "🙌", "open_hands": "👐", "palms_up": "🤲",
  "handshake": "🤝", "pray": "🙏", "muscle": "💪", "selfie": "🤳",
  "nail_care": "💅", "ear": "👂", "nose": "👃",
  "heart": "❤️", "orange_heart": "🧡", "yellow_heart": "💛", "green_heart": "💚",
  "blue_heart": "💙", "purple_heart": "💜", "brown_heart": "🤎", "black_heart": "🖤",
  "white_heart": "🤍", "two_hearts": "💕", "revolving_hearts": "💞",
  "sparkling_heart": "💖", "heartpulse": "💗", "heartbeat": "💓", "cupid": "💘",
  "gift_heart": "💝", "broken_heart": "💔", "100": "💯", "anger": "💢",
  "boom": "💥", "sweat_drops": "💦", "dash": "💨", "hole": "🕳️",
  "fire": "🔥", "rocket": "🚀", "star": "⭐", "sparkles": "✨",
  "zap": "⚡", "rainbow": "🌈", "snowflake": "❄️", "sunny": "☀️",
  "thumbsup": "👍", "+1": "👍", "thumbsdown": "👎", "-1": "👎",
  "white_check_mark": "✅", "ballot_box_with_check": "☑️", "heavy_check_mark": "✔️",
  "x": "❌", "red_circle": "🔴", "large_blue_circle": "🔵",
  "large_orange_diamond": "🔶", "large_blue_diamond": "🔷",
  "small_red_triangle": "🔺", "small_red_triangle_down": "🔻",
  "arrow_up": "⬆️", "arrow_down": "⬇️", "arrow_right": "➡️", "arrow_left": "⬅️",
  "warning": "⚠️", "no_entry": "⛔", "no_entry_sign": "🚫",
  "memo": "📝", "pencil": "✏️", "envelope": "✉️", "telephone": "☎️",
  "bulb": "💡", "book": "📖", "books": "📚", "mag": "🔍", "mag_right": "🔎",
  "lock": "🔒", "unlock": "🔓", "key": "🔑", "link": "🔗", "clipboard": "📋",
  "pushpin": "📌", "paperclip": "📎", "scissors": "✂️",
  "hammer": "🔨", "wrench": "🔧", "gear": "⚙️",
  "alarm_clock": "⏰", "hourglass": "⌛", "watch": "⌚",
  "moneybag": "💰", "gem": "💎", "gift": "🎁",
  "tada": "🎉", "confetti": "🎊", "balloon": "🎈", "camera": "📷",
  "computer": "💻", "chart": "📊", "calendar": "📅",
  "seedling": "🌱", "palm_tree": "🌴", "cactus": "🌵", "tulip": "🌷",
  "cherry_blossom": "🌸", "rose": "🌹", "sunflower": "🌻", "four_leaf_clover": "🍀",
  "maple_leaf": "🍁", "mushroom": "🍄", "earth": "🌍", "moon": "🌙",
  "full_moon": "🌕", "dog": "🐶", "cat": "🐱", "fox": "🦊", "bear": "🐻",
  "panda": "🐼", "koala": "🐨", "lion": "🦁", "pig": "🐷", "frog": "🐸",
  "monkey": "🐵", "chicken": "🐔", "bird": "🐦", "penguin": "🐧",
  "butterfly": "🦋", "snail": "🐌", "bee": "🐝", "fish": "🐟", "octopus": "🐙",
  "apple": "🍎", "pear": "🍐", "tangerine": "🍊", "lemon": "🍋", "banana": "🍌",
  "watermelon": "🍉", "grapes": "🍇", "strawberry": "🍓", "cherries": "🍒",
  "peach": "🍑", "mango": "🥭", "pineapple": "🍍", "avocado": "🥑",
  "eggplant": "🍆", "potato": "🥔", "carrot": "🥕", "corn": "🌽",
  "bread": "🍞", "cheese": "🧀", "pizza": "🍕", "hamburger": "🍔", "fries": "🍟",
  "hotdog": "🌭", "sandwich": "🥪", "taco": "🌮", "burrito": "🌯",
  "coffee": "☕", "tea": "🍵", "beer": "🍺", "beers": "🍻", "cocktail": "🍸",
  "heart_hands": "🫶",
}

/** Replace Slack emoji shortcodes (`:emoji:`) with unicode emoji characters. */
export function parseSlackEmojis(text: string): string {
  return text.replace(/:([a-z0-9_+\-]+):/gi, (match, name) => {
    return EMOJI_MAP[name.toLowerCase()] ?? match
  })
}

/**
 * Build a permalink to a specific Slack message.
 */
export function getMessagePermalink(
  workspaceUrl: string,
  channelId: string,
  ts: string
): string {
  const tsClean = ts.replace(".", "")
  return `${workspaceUrl}/archives/${channelId}/p${tsClean}`
}
