import KeyboardKitPro
import SwiftUI

// Matches the key geometry of Apple's own keyboard, measured live via
// EmapthyAiUITests.NativeKeyboardMeasurementUITest on an iPhone 16 Pro:
//
// - Row height: KeyboardKit 9.9 adds a +2pt "liquid glass" row-height bump
//   on iOS 26 phone portrait (56pt rows), but the real Apple keyboard on
//   the same device still lays out 54pt rows (letter rows at y
//   590/644/698/752) — which made EmapthyAi's keys feel slightly bigger.
// - Side margins: Apple insets each row ~3.5pt from the screen edges
//   (native letter boxes span x 4.67..399.67 = 395pt on a 402pt screen);
//   KeyboardKit lays rows out edge-to-edge, making every key ~1pt wider.
//
// The patch keeps the liquid-glass STYLING (colors, corner radius, shadows)
// and only restores the native geometry.
//
// Deliberately NOT a KeyboardLayoutService replacement: Pro's license
// registration calls tryRegisterLocalizedService on the current service,
// which throws (and killed the extension) unless that service is a
// KeyboardLayout.StandardLayoutService — so the patch is applied to the
// resolved layout at view composition instead of wrapping the service.
enum NativeKeyboardMetrics {
    private static let sideMargin: CGFloat = 3.5

    static func patchedLayout(
        from service: KeyboardLayoutService,
        for context: KeyboardContext
    ) -> KeyboardLayout {
        let layout = service.keyboardLayout(for: context)
        let native = KeyboardLayout.DeviceConfiguration.standard(
            forDevice: context.deviceTypeForKeyboard,
            screenSize: context.screenSize,
            orientation: context.interfaceOrientation,
            liquidGlass: false
        )
        guard var config = layout.deviceConfiguration,
              config.rowHeight != native.rowHeight
        else { return layout }
        let bumpedRowHeight = config.rowHeight
        config.rowHeight = native.rowHeight
        // Apple top-aligns each drawn key in its 54pt pitch box (~1pt above,
        // ~10pt gap below, key ≈43pt tall); KeyboardKit centers it (4.5pt
        // both sides). Pixel-measured from the same on-device screenshots
        // as the row/margin numbers above.
        let nativeTopInset: CGFloat = 1.0
        let nativeBottomInset: CGFloat = 10.0
        // No emoji key on the bottom row (Apple has one): KeyboardView
        // strips .keyboardType(.emojis) items when no emoji keyboard is
        // available, and the Pro emoji keyboard needs a higher license tier
        // (Emoji.KeyboardWrapper.isEmptyPlaceholder is true at ours) — an
        // inserted key would be removed, or worse, open nothing.
        let rows = layout.itemRows.map { row -> KeyboardLayout.ItemRow in
            let row = row.map { item -> KeyboardLayout.Item in
                guard item.size.height == bumpedRowHeight else { return item }
                var item = item
                item.size.height = native.rowHeight
                item.edgeInsets.top = nativeTopInset
                item.edgeInsets.bottom = nativeBottomInset
                return item
            }
            let rowHeight = row.first?.size.height ?? native.rowHeight
            let margin = KeyboardLayout.Item(
                action: .characterMargin(""),
                size: .init(width: .points(sideMargin), height: rowHeight)
            )
            return [margin] + row + [margin]
        }
        // Rebuilt through the initializer instead of mutating the copy: the
        // layout's width cache is a shared reference keyed only by total
        // width, so mutating rows in place would let another copy's cached
        // input width (computed without the margins) leak into this one.
        return KeyboardLayout(
            itemRows: rows,
            deviceConfiguration: config,
            iPadProLayout: layout.isIpadProLayout,
            idealItemHeight: native.rowHeight,
            idealItemInsets: layout.idealItemInsets,
            inputToolbarInputSet: layout.inputToolbarInputSet
        )
    }
}
