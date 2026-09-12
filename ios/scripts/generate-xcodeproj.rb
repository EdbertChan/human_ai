#!/usr/bin/env ruby
# frozen_string_literal: true

# Generates apps/ios/EmapthyAi.xcodeproj from the plain source files in this
# directory, using the `xcodeproj` gem (CocoaPods' project-manipulation
# library). Hand-editing a multi-target pbxproj by text is fragile and
# error-prone — this script keeps the project reproducible from plain Ruby
# instead of a hand-maintained binary-ish project file.
#
# Usage:
#   gem install xcodeproj   # if not already installed
#   ruby apps/ios/scripts/generate-xcodeproj.rb

require "xcodeproj"
require "fileutils"

ROOT = File.expand_path("..", __dir__)
PROJECT_PATH = File.join(ROOT, "EmapthyAi.xcodeproj")
BUNDLE_ID = "com.nekocatpitalventures.emapthyai"
DEPLOYMENT_TARGET = "16.0"
# Edbert Chan's personal Apple Development team. Baked in so it survives
# project regeneration instead of only living in Xcode's GUI-set state or a
# one-off xcodebuild command-line override.
DEVELOPMENT_TEAM = "3AXMP8C34Z"

FileUtils.rm_rf(PROJECT_PATH)
project = Xcodeproj::Project.new(PROJECT_PATH)

def common_build_settings(bundle_id)
  {
    "PRODUCT_BUNDLE_IDENTIFIER" => bundle_id,
    "IPHONEOS_DEPLOYMENT_TARGET" => DEPLOYMENT_TARGET,
    "SWIFT_VERSION" => "6.0",
    "TARGETED_DEVICE_FAMILY" => "1",
    "CODE_SIGN_STYLE" => "Automatic",
    "DEVELOPMENT_TEAM" => DEVELOPMENT_TEAM,
    "GENERATE_INFOPLIST_FILE" => "NO",
    "MARKETING_VERSION" => "1.0",
    "CURRENT_PROJECT_VERSION" => "4"
  }
end

framework_refs = {}
def framework_ref(project, cache, name)
  cache[name] ||= project.frameworks_group.new_file(
    "System/Library/Frameworks/#{name}.framework", :sdk_root
  )
end

def link_frameworks(target, project, cache, names)
  names.each { |name| target.frameworks_build_phase.add_file_reference(framework_ref(project, cache, name), true) }
end

# --- Remote Swift Package support ---
# The `xcodeproj` gem (1.28.1) has no high-level helper for SPM dependencies,
# so the package/product/build-file objects are wired up by hand here.
def remote_package(project, cache, url, requirement)
  cache[url] ||= begin
    ref = project.new(Xcodeproj::Project::Object::XCRemoteSwiftPackageReference)
    ref.repositoryURL = url
    ref.requirement = requirement
    project.root_object.package_references << ref
    ref
  end
end

def link_package_product(project, target, package_ref, product_name)
  dependency = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
  dependency.package = package_ref
  dependency.product_name = product_name
  target.package_product_dependencies << dependency

  build_file = project.new(Xcodeproj::Project::Object::PBXBuildFile)
  build_file.product_ref = dependency
  target.frameworks_build_phase.files << build_file
end

# --- Groups & file references ---
shared_group = project.main_group.new_group("Shared", "Shared")
shared_files = Dir.glob(File.join(ROOT, "Shared", "*.swift")).sort.map { |p| shared_group.new_file(p) }

app_group = project.main_group.new_group("EmapthyAi", "EmapthyAi")
app_swift = Dir.glob(File.join(ROOT, "EmapthyAi", "*.swift")).sort.map { |p| app_group.new_file(p) }
app_group.new_file(File.join(ROOT, "EmapthyAi", "Info.plist"))
app_group.new_file(File.join(ROOT, "EmapthyAi", "EmapthyAi.entitlements"))
app_assets = app_group.new_file(File.join(ROOT, "EmapthyAi", "Assets.xcassets"))

keyboard_group = project.main_group.new_group("EmapthyAiKeyboard", "EmapthyAiKeyboard")
keyboard_swift = Dir.glob(File.join(ROOT, "EmapthyAiKeyboard", "*.swift")).sort.map { |p| keyboard_group.new_file(p) }
keyboard_group.new_file(File.join(ROOT, "EmapthyAiKeyboard", "Info.plist"))
keyboard_group.new_file(File.join(ROOT, "EmapthyAiKeyboard", "EmapthyAiKeyboard.entitlements"))

action_group = project.main_group.new_group("EmapthyAiAction", "EmapthyAiAction")
action_swift = Dir.glob(File.join(ROOT, "EmapthyAiAction", "*.swift")).sort.map { |p| action_group.new_file(p) }
action_group.new_file(File.join(ROOT, "EmapthyAiAction", "Info.plist"))
action_group.new_file(File.join(ROOT, "EmapthyAiAction", "EmapthyAiAction.entitlements"))

# Logic-only unit test bundle: renders KeyboardViewController's actual view
# off-screen and writes it to a PNG, so layout bugs (like content getting
# clipped by the keyboard's height) are caught by `xcodebuild test` instead
# of by a human tapping through the Simulator or a real device.
layout_tests_group = project.main_group.new_group("EmapthyAiLayoutTests", "EmapthyAiLayoutTests")
layout_tests_swift = Dir.glob(File.join(ROOT, "EmapthyAiLayoutTests", "*.swift")).sort.map { |p| layout_tests_group.new_file(p) }

# Real-device UI test bundle: drives EmapthyAiToolbarView with actual touch
# events (not a static render) via a debug-only host screen in the app
# (ReviewCardUITestHostViewController), since a layout/height check alone
# can't tell whether a ScrollView actually responds to a swipe.
ui_tests_group = project.main_group.new_group("EmapthyAiUITests", "EmapthyAiUITests")
ui_tests_swift = Dir.glob(File.join(ROOT, "EmapthyAiUITests", "*.swift")).sort.map { |p| ui_tests_group.new_file(p) }

# --- Targets ---
app_target = project.new_target(:application, "EmapthyAi", :ios, DEPLOYMENT_TARGET)
keyboard_target = project.new_target(:app_extension, "EmapthyAiKeyboard", :ios, DEPLOYMENT_TARGET)
action_target = project.new_target(:app_extension, "EmapthyAiAction", :ios, DEPLOYMENT_TARGET)
layout_tests_target = project.new_target(:unit_test_bundle, "EmapthyAiLayoutTests", :ios, DEPLOYMENT_TARGET)
ui_tests_target = project.new_target(:ui_test_bundle, "EmapthyAiUITests", :ios, DEPLOYMENT_TARGET)

# The UI test host screen needs EmapthyAiToolbarView/EmapthyAiToolbarModel,
# which live under EmapthyAiKeyboard/ (compiled into the extension target),
# so the app target also compiles those files directly — same
# compile-the-source-directly pattern layout_tests_target already uses below,
# rather than importing the extension as a module.
app_target.add_file_references(app_swift + keyboard_swift + shared_files)
keyboard_target.add_file_references(keyboard_swift + shared_files)
action_target.add_file_references(action_swift + shared_files.reject { |file| File.basename(file.path) == "EmapthyAiKeyboardApp.swift" })
app_target.resources_build_phase.add_file_reference(app_assets)
# Compiles KeyboardViewController.swift directly into the test bundle (same
# pattern as Shared/ across every other target) instead of importing the
# extension as a module, which avoids app-extension test-host complications.
layout_tests_target.add_file_references(layout_tests_swift + keyboard_swift + shared_files)
ui_tests_target.add_file_references(ui_tests_swift)

link_frameworks(app_target, project, framework_refs, %w[UIKit Foundation])
link_frameworks(keyboard_target, project, framework_refs, %w[UIKit Foundation])
link_frameworks(action_target, project, framework_refs, %w[UIKit Foundation UniformTypeIdentifiers])
link_frameworks(layout_tests_target, project, framework_refs, %w[UIKit Foundation])
link_frameworks(ui_tests_target, project, framework_refs, %w[XCTest])

# --- KeyboardKit ---
package_cache = {}
keyboard_kit = remote_package(
  project, package_cache, "https://github.com/KeyboardKit/KeyboardKit.git",
  { "kind" => "upToNextMajorVersion", "minimumVersion" => "9.0.0" }
)
link_package_product(project, app_target, keyboard_kit, "KeyboardKit")
link_package_product(project, keyboard_target, keyboard_kit, "KeyboardKit")
link_package_product(project, layout_tests_target, keyboard_kit, "KeyboardKit")

# --- Embed both extensions into the app ---
app_target.add_dependency(keyboard_target)
app_target.add_dependency(action_target)
embed_phase = app_target.new_copy_files_build_phase("Embed Foundation Extensions")
embed_phase.symbol_dst_subfolder_spec = :plug_ins
[keyboard_target, action_target].each do |ext_target|
  build_file = embed_phase.add_file_reference(ext_target.product_reference)
  build_file.settings = { "ATTRIBUTES" => ["RemoveHeadersOnCopy"] }
end

# --- Per-target build settings ---
app_target.build_configurations.each do |config|
  config.build_settings.merge!(common_build_settings(BUNDLE_ID))
  config.build_settings["EMAPTHYAI_DEV_API_URL"] = "http://192.168.1.106:8787" if config.name == "Debug"
  config.build_settings["INFOPLIST_FILE"] = "EmapthyAi/Info.plist"
  config.build_settings["CODE_SIGN_ENTITLEMENTS"] = "EmapthyAi/EmapthyAi.entitlements"
  config.build_settings["ASSETCATALOG_COMPILER_APPICON_NAME"] = "AppIcon"
  config.build_settings["LD_RUNPATH_SEARCH_PATHS"] = ["$(inherited)", "@executable_path/Frameworks"]
end

keyboard_target.build_configurations.each do |config|
  config.build_settings.merge!(common_build_settings("#{BUNDLE_ID}.Keyboard"))
  config.build_settings["EMAPTHYAI_DEV_API_URL"] = "http://192.168.1.106:8787" if config.name == "Debug"
  config.build_settings["INFOPLIST_FILE"] = "EmapthyAiKeyboard/Info.plist"
  config.build_settings["CODE_SIGN_ENTITLEMENTS"] = "EmapthyAiKeyboard/EmapthyAiKeyboard.entitlements"
  config.build_settings["SKIP_INSTALL"] = "YES"
  config.build_settings["LD_RUNPATH_SEARCH_PATHS"] = ["$(inherited)", "@executable_path/../../Frameworks"]
end

action_target.build_configurations.each do |config|
  config.build_settings.merge!(common_build_settings("#{BUNDLE_ID}.Action"))
  config.build_settings["INFOPLIST_FILE"] = "EmapthyAiAction/Info.plist"
  config.build_settings["CODE_SIGN_ENTITLEMENTS"] = "EmapthyAiAction/EmapthyAiAction.entitlements"
  config.build_settings["SKIP_INSTALL"] = "YES"
end

layout_tests_target.build_configurations.each do |config|
  config.build_settings.merge!(common_build_settings("#{BUNDLE_ID}.LayoutTests"))
  config.build_settings["GENERATE_INFOPLIST_FILE"] = "YES"
  config.build_settings["CODE_SIGN_STYLE"] = "Automatic"
end

ui_tests_target.build_configurations.each do |config|
  config.build_settings.merge!(common_build_settings("#{BUNDLE_ID}.UITests"))
  config.build_settings["GENERATE_INFOPLIST_FILE"] = "YES"
  config.build_settings["CODE_SIGN_STYLE"] = "Automatic"
  config.build_settings["TEST_TARGET_NAME"] = "EmapthyAi"
end
ui_tests_target.add_dependency(app_target)

# App Groups capability for the app and keyboard targets only: the group
# (group.com.nekocatpitalventures.emapthyai) carries the shared anonymous
# analytics distinct ID plus the debug-only server-URL override — never
# draft text or rewrite results. The entitlement itself lives in each
# target's checked-in .entitlements file (already wired via
# CODE_SIGN_ENTITLEMENTS above); this TargetAttributes block keeps Xcode's
# capability toggle in sync so regeneration never strips the capability.
# The action extension is deliberately left out until its code needs
# telemetry. RewriteSettings.swift still degrades safely if provisioning
# lacks the group (process-local ID, hardcoded production endpoint).
project.root_object.attributes["TargetAttributes"] ||= {}
[app_target, keyboard_target].each do |target|
  project.root_object.attributes["TargetAttributes"][target.uuid] = {
    "SystemCapabilities" => {
      "com.apple.ApplicationGroups.iOS" => { "enabled" => "1" }
    }
  }
end

project.save

# --- Explicit shared scheme for the app ---
# Xcode's auto-created scheme for a project with extension targets can leave
# the Run action's executable set to "Ask on Launch" instead of pinned to
# the app itself, which surfaces as a "Choose an app to run" picker on every
# Run — writing the scheme explicitly avoids relying on that autocreation.
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app_target)
scheme.add_build_target(keyboard_target)
scheme.add_build_target(action_target)
scheme.add_test_target(layout_tests_target)
scheme.add_test_target(ui_tests_target)
scheme.set_launch_target(app_target)
scheme.save_as(project.path, "EmapthyAi", true)

puts "Generated #{PROJECT_PATH}"
puts "  targets: #{[app_target, keyboard_target, action_target, layout_tests_target, ui_tests_target].map(&:name).join(', ')}"
