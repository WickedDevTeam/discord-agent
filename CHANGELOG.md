# Changelog

All notable changes to the Kindroid Discord Multi-Account Manager will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-01-06

### 🎉 Major Features Added

#### User Account Support
- **NEW**: Discord user account support alongside existing bot accounts
- **NEW**: Identical feature set for both account types (Reddit images, AI responses, etc.)
- **NEW**: More natural interactions with user accounts vs traditional bots
- **NEW**: Proper authentication handling for both bot and user tokens

#### Unified Interaction System
- **NEW**: Simple 1-100 interaction rate system for autonomous responses
- **NEW**: Intelligent content analysis that boosts response probability for:
  - Questions (contains `?`)
  - Emotional content (excitement, love, frustration, etc.)
  - Longer messages (>100 characters)
  - Exclamations (contains `!`)
- **NEW**: Smart probability calculations with natural conversation flow
- **NEW**: Always responds to direct mentions regardless of interaction rate

#### Enhanced Response Logic
- **NEW**: Realistic human-like response timing based on conversation history
- **NEW**: Typing indicators that appear partway through response delays
- **NEW**: Context-aware timing (faster for DMs, questions, mentions)
- **NEW**: Account-to-account interaction support with spam prevention

### 🔧 Improvements

#### Configuration System
- **IMPROVED**: Environment variable loading supports both account types
- **IMPROVED**: Backward compatibility with existing bot configurations
- **IMPROVED**: Legacy user account settings still supported
- **IMPROVED**: Comprehensive .env.example with detailed guidance
- **IMPROVED**: Clear separation between bot and user account settings

#### Architecture Updates
- **IMPROVED**: Renamed "bot-to-bot" logic to "account-to-account" for clarity
- **IMPROVED**: Unified account management across all features
- **IMPROVED**: Type system extended with AccountConfig union type
- **IMPROVED**: Enhanced error handling and graceful degradation
- **IMPROVED**: Better logging with account type prefixes

#### Documentation
- **IMPROVED**: Comprehensive README.md update with new features
- **IMPROVED**: Enhanced CLAUDE.md with architectural details
- **IMPROVED**: Detailed troubleshooting guides
- **IMPROVED**: Configuration examples for all scenarios
- **IMPROVED**: Security notes for user account handling

### 🧪 Testing & Quality

#### Test Suite
- **NEW**: Comprehensive test suite with 7 test files
- **NEW**: Interaction rate probability testing
- **NEW**: Backward compatibility validation
- **NEW**: Edge case and error handling tests
- **NEW**: Integration testing for all features
- **NEW**: Reddit image functionality testing
- **NEW**: Timing system validation
- **NEW**: Debug cheat code testing

#### Code Quality
- **IMPROVED**: Zero ESLint violations
- **IMPROVED**: Strict TypeScript compilation
- **IMPROVED**: Clean build process
- **IMPROVED**: Consistent code formatting
- **IMPROVED**: Comprehensive type coverage

### 🛠️ Technical Changes

#### Type System
- **NEW**: `AccountConfig` union type for both bot and user accounts
- **NEW**: `BaseAccountConfig` interface with shared properties
- **UPDATED**: `UserConfig` interface with legacy settings support
- **UPDATED**: All functions updated to work with AccountConfig

#### Configuration Loading
- **NEW**: `loadUserConfigs()` function for user account discovery
- **NEW**: `loadAllAccountConfigs()` function combining both types
- **UPDATED**: Environment variable parsing with interaction rate support
- **UPDATED**: Validation logic for mixed account configurations

#### Response System
- **NEW**: `shouldAccountRespond()` unified response logic
- **NEW**: `shouldLegacyUserAccountRespond()` for backward compatibility
- **UPDATED**: Smart content analysis with configurable thresholds
- **UPDATED**: Probability calculations with natural conversation flow

### 🔧 Fixes

#### Bug Fixes
- **FIXED**: Chain prevention logic incorrectly implemented for incoming vs outgoing messages
- **FIXED**: Legacy user accounts not receiving proper function parameters
- **FIXED**: TypeScript compilation errors with strict settings
- **FIXED**: ESLint warnings about explicit types
- **FIXED**: Inconsistent naming between bot and account terminology

#### Backward Compatibility
- **MAINTAINED**: All existing bot configurations work unchanged
- **MAINTAINED**: Legacy user account frequency/behavior settings supported
- **MAINTAINED**: Existing environment variable names preserved
- **MAINTAINED**: API compatibility for existing deployments

### 📖 Documentation Updates

#### README.md
- **UPDATED**: Project title and description
- **NEW**: Comprehensive configuration guide
- **NEW**: User account setup instructions
- **NEW**: Mixed account configuration examples
- **NEW**: Troubleshooting section
- **NEW**: Development and testing information

#### CLAUDE.md
- **UPDATED**: Architecture documentation for multi-account support
- **NEW**: Unified interaction system documentation
- **NEW**: Account-to-account interaction details
- **UPDATED**: All references from "bot" to "account" where appropriate

#### .env.example
- **COMPLETELY REWRITTEN**: Comprehensive configuration examples
- **NEW**: Detailed interaction rate guide
- **NEW**: Security notes and best practices
- **NEW**: Advanced configuration examples
- **NEW**: Both bot and user account examples

### 🔄 Migration Guide

#### For Existing Bot Users
- **NO CHANGES REQUIRED**: All existing configurations work as-is
- **OPTIONAL**: Add `INTERACTION_RATE_X=50` for autonomous responses
- **OPTIONAL**: Keep existing setup for mention-only responses

#### For New Users
- **RECOMMENDED**: Use new interaction rate system for all accounts
- **CHOICE**: Mix and match bot and user accounts as needed
- **CONFIGURATION**: Follow updated .env.example for best practices

#### For User Account Users
- **BACKWARD COMPATIBLE**: Legacy frequency/behavior settings still work
- **RECOMMENDED**: Migrate to interaction rate system for consistency
- **ENHANCED**: New intelligent response logic available

---

## [1.0.1] - Previous Release

### Features
- Multi-bot Discord support
- Kindroid AI integration
- JIT message fetching
- Reddit image attachments
- NSFW filtering
- Graceful shutdown handling

### Architecture
- TypeScript codebase
- Discord.js v14 integration
- Environment-based configuration
- Error handling and logging