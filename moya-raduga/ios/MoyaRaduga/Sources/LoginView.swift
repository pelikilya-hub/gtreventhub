import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var client: RadugaClient
    @State private var code = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(spacing: 22) {
            Spacer()
            RainbowMark().frame(width: 190, height: 110)
            Text("Моя радуга").font(.hand(52)).foregroundStyle(Ink.ink)
            Text("Введи код, который тебе дали")
                .font(.text(17)).foregroundStyle(Ink.ink)

            TextField("КОД", text: $code)
                .font(.text(26, bold: true))
                .multilineTextAlignment(.center)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .foregroundStyle(Ink.ink)
                .padding(.horizontal, 16)
                .frame(height: 60)
                .sticker(.white)
                .padding(.horizontal, 40)
                .onSubmit(enter)

            if let error {
                Text(error).font(.text(15, bold: true)).foregroundStyle(Color(hex: 0xB52A21))
            }

            Button(busy ? "Открываю…" : "Войти", action: enter)
                .buttonStyle(StickerButtonStyle())
                .disabled(busy)
            Spacer()
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .background(Paper())
    }

    private func enter() {
        guard !busy else { return }
        busy = true
        Task {
            error = await client.login(code: code)
            busy = false
        }
    }
}

/// Радуга фломастером — тот же знак, что на иконке.
struct RainbowMark: View {
    var body: some View {
        Canvas { context, size in
            let colors = [Ink.red, Color(hex: 0xFF9A1F), Color(hex: 0xFFD21F), Ink.green, Ink.blue]
            let band = size.width / 15
            let center = CGPoint(x: size.width / 2, y: size.height)
            for (i, color) in colors.enumerated() {
                var arc = Path()
                arc.addArc(center: center, radius: size.width / 2 - band / 2 - CGFloat(i) * band * 1.25,
                           startAngle: .degrees(180), endAngle: .degrees(360), clockwise: false)
                context.stroke(arc, with: .color(color), style: StrokeStyle(lineWidth: band, lineCap: .round))
            }
        }
        .accessibilityHidden(true)
    }
}
