import SwiftUI

/// Палитра и «наклеечный» стиль концепта «Альбом».
enum Ink {
    static let ink = Color(hex: 0x22223B)
    static let paper = Color(hex: 0xFFFBEF)
    static let dot = Color(hex: 0xD9D2BD)
    static let yellow = Color(hex: 0xFFE14D)
    static let red = Color(hex: 0xF0483E)
    static let blue = Color(hex: 0x2D7FF9)
    static let deepBlue = Color(hex: 0x2468D6)
    static let green = Color(hex: 0x1FA85A)
    static let violet = Color(hex: 0x8A4DFF)
    static let lilac = Color(hex: 0xE7DAFF)
    static let sky = Color(hex: 0xCFE6FF)
    static let cream = Color(hex: 0xFFF3B0)

    /// Фломастеры рисовалки.
    static let markers = ["#F0483E", "#FF9A1F", "#FFD21F", "#1FA85A", "#2D7FF9", "#8A4DFF", "#22223B"]
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }

    /// "#RRGGBB" с сервера; мусор превращается в цвет чернил.
    init(hexString: String) {
        let digits = hexString.hasPrefix("#") ? String(hexString.dropFirst()) : hexString
        self.init(hex: UInt32(digits, radix: 16) ?? 0x22223B)
    }
}

extension Font {
    static func text(_ size: CGFloat, bold: Bool = false) -> Font {
        .custom(bold ? "BalsamiqSans-Bold" : "BalsamiqSans-Regular", size: size)
    }

    static func hand(_ size: CGFloat) -> Font {
        .custom("Neucha", size: size)
    }
}

/// Карточка-наклейка: обводка чернилами и жёсткая тень со сдвигом.
struct Sticker: ViewModifier {
    var fill: Color = .white
    var shadow: Color = Ink.ink
    var radius: CGFloat = 16
    var offset: CGFloat = 4

    func body(content: Content) -> some View {
        content.background(
            ZStack {
                RoundedRectangle(cornerRadius: radius).fill(shadow).offset(x: offset, y: offset)
                RoundedRectangle(cornerRadius: radius).fill(fill)
                RoundedRectangle(cornerRadius: radius).strokeBorder(Ink.ink, lineWidth: 2.5)
            }
        )
    }
}

extension View {
    func sticker(_ fill: Color = .white, shadow: Color = Ink.ink, radius: CGFloat = 16, offset: CGFloat = 4) -> some View {
        modifier(Sticker(fill: fill, shadow: shadow, radius: radius, offset: offset))
    }
}

/// Кнопка-наклейка: при нажатии «прилипает» к бумаге.
struct StickerButtonStyle: ButtonStyle {
    var fill: Color = Ink.yellow
    var radius: CGFloat = 16

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.text(16, bold: true))
            .foregroundStyle(Ink.ink)
            .padding(.horizontal, 16)
            .frame(minHeight: 48)
            .sticker(fill, radius: radius, offset: configuration.isPressed ? 1 : 4)
            .offset(x: configuration.isPressed ? 3 : 0, y: configuration.isPressed ? 3 : 0)
            .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
    }
}

/// Бумага в точку.
struct Paper: View {
    var body: some View {
        Canvas { context, size in
            let step: CGFloat = 18
            var y = step / 2
            while y < size.height {
                var x = step / 2
                while x < size.width {
                    context.fill(Path(ellipseIn: CGRect(x: x - 1.2, y: y - 1.2, width: 2.4, height: 2.4)), with: .color(Ink.dot))
                    x += step
                }
                y += step
            }
        }
        .background(Ink.paper)
        .ignoresSafeArea()
    }
}

/// Квадратик с первой буквой имени.
struct Avatar: View {
    let member: Member?
    var size: CGFloat = 50
    var dimmed = false

    var body: some View {
        Text(String(member?.name.prefix(1) ?? "?"))
            .font(.text(size * 0.4, bold: true))
            .foregroundStyle(Ink.ink)
            .frame(width: size, height: size)
            .sticker(Color(hexString: member?.color ?? "#FFFFFF"), radius: size * 0.32, offset: size > 40 ? 3 : 2)
            .opacity(dimmed ? 0.45 : 1)
    }
}
