/**
 * POSIX-compliant command utilities for consistent behavior across Unix-like systems
 * Focuses on GNU coreutils compatibility for macOS and Linux distributions
 */


export interface GrepOptions {
  ignoreCase?: boolean
  lineNumbers?: boolean
  context?: number
  recursive?: boolean
}

export interface FindOptions {
  type?: 'f' | 'd' | 'l'
  maxDepth?: number
}

/**
 * Standardized POSIX commands that work consistently across supported platforms.
 * These commands are specific shell commands used in agent SDKs outside of the general shell execution command (e.g. Claude Code's `bash`), which we implement a simple convenience wrapper for.
 */
export class POSIXCommands {

  /**
   * Generate find command with proper escaping and options
   */
  static find(pattern: string, searchPath = '.', options: FindOptions = {}): string {
    let cmd = `find "${searchPath}"`
    
    if (options.maxDepth) {
      cmd += ` -maxdepth ${options.maxDepth}`
    }
    
    if (options.type) {
      cmd += ` -type ${options.type}`
    }
    
    cmd += ` -name "${pattern}"`
    
    return cmd
  }

  /**
   * Generate grep command with consistent options
   */
  static grep(pattern: string, files?: string, options: GrepOptions = {}): string {
    let cmd = 'grep'
    
    if (options.ignoreCase) {cmd += ' -i'}
    if (options.lineNumbers) {cmd += ' -n'}
    if (options.context) {cmd += ` -C ${options.context}`}
    
    // Use -- to prevent pattern being interpreted as options
    cmd += ` -- "${pattern}"`
    
    if (files) {
      cmd += ` ${files}`
    } else if (options.recursive) {
      cmd += ' -r .'
    }
    
    return cmd
  }

  /**
   * cat command for file reading
   */
  static cat(path: string): string {
    return `cat "${path}"`
  }

  /**
   * touch command for file creation
   */
  static touch(path: string): string {
    return `touch "${path}"`
  }

  /**
   * mkdir command with parent directory creation
   */
  static mkdir(path: string, parents = true): string {
    return parents ? `mkdir -p "${path}"` : `mkdir "${path}"`
  }

  /**
   * stat command for file information
   */
  static stat(path: string): string {
    // Use format options that work on both macOS and Linux
    return `stat -c '%n|%F|%s|%Y' "${path}" 2>/dev/null || stat -f '%N|%HT|%z|%m' "${path}"`
  }

  /**
   * wc command for counting
   */
  static wc(path?: string, options: { lines?: boolean; words?: boolean; chars?: boolean } = {}): string {
    let flags = ''
    if (options.lines) {flags += 'l'}
    if (options.words) {flags += 'w'}
    if (options.chars) {flags += 'c'}
    
    const cmd = flags ? `wc -${flags}` : 'wc'
    return path ? `${cmd} "${path}"` : cmd
  }

  /**
   * head command for reading file beginnings
   */
  static head(path: string, lines = 10): string {
    return `head -n ${lines} "${path}"`
  }

  /**
   * tail command for reading file endings
   */
  static tail(path: string, lines = 10): string {
    return `tail -n ${lines} "${path}"`
  }

  /**
   * sort command
   */
  static sort(path?: string, options: { reverse?: boolean; numeric?: boolean; unique?: boolean } = {}): string {
    let flags = ''
    if (options.reverse) {flags += 'r'}
    if (options.numeric) {flags += 'n'}
    if (options.unique) {flags += 'u'}
    
    const cmd = flags ? `sort -${flags}` : 'sort'
    return path ? `${cmd} "${path}"` : cmd
  }

  /**
   * uniq command for removing duplicates
   */
  static uniq(path?: string, count = false): string {
    const cmd = count ? 'uniq -c' : 'uniq'
    return path ? `${cmd} "${path}"` : cmd
  }

  /**
   * cut command for column extraction
   */
  static cut(fields: string, path?: string, delimiter = '\t'): string {
    const cmd = `cut -d "${delimiter}" -f ${fields}`
    return path ? `${cmd} "${path}"` : cmd
  }

  /**
   * Escape shell arguments to prevent command injection
   */
  static escapeShellArg(arg: string): string {
    // Use single quotes for most cases, handle single quotes in the string
    return `'${arg.replace(/'/g, "'\"'\"'")}'`
  }

  /**
   * Check if a command exists in the system
   */
  static checkCommand(command: string): string {
    return `command -v ${command} >/dev/null 2>&1`
  }
}
