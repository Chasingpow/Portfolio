import type { Config } from "tailwindcss"

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#1e1f22",
        card: "#2b2d31",
        "card-alt": "#313338",
        accent: "#5865F2",
        green: "#6ECB81",
        amber: "#F0B23C",
        red: "#EB695F",
        divider: "#3c3f45",
        sub: "#b5bac1",
        muted: "#94a0b0",
      },
    },
  },
  plugins: [],
}

export default config
