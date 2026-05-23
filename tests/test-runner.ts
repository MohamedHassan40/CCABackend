/**
 * Comprehensive Test Runner
 * 
 * This script runs all tests across all modules and generates a report
 * showing what's working and what needs attention.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface TestResult {
  module: string;
  passed: boolean;
  error?: string;
  testsRun?: number;
  testsPassed?: number;
  testsFailed?: number;
}

async function runTests(): Promise<void> {
  console.log('🧪 Starting comprehensive module testing...\n');
  
  const modules = [
    { name: 'Authentication', path: 'tests/integration/auth.test.ts' },
    { name: 'HR Module - Employees', path: 'tests/modules/hr.employees.test.ts' },
    { name: 'HR Module - Leave', path: 'tests/modules/hr.leave.test.ts' },
    { name: 'HR Module - Attendance', path: 'tests/modules/hr.attendance.test.ts' },
    { name: 'Ticketing Module', path: 'tests/modules/ticketing.test.ts' },
    { name: 'Billing Module', path: 'tests/modules/billing.test.ts' },
    { name: 'Marketplace Module', path: 'tests/modules/marketplace.test.ts' },
    { name: 'Permissions', path: 'tests/unit/permissions.test.ts' },
  ];

  const results: TestResult[] = [];

  for (const module of modules) {
    try {
      console.log(`📦 Testing ${module.name}...`);
      
      const { stdout, stderr } = await execAsync(
        `npx vitest run ${module.path} --reporter=verbose`
      );
      
      // Parse results (simplified - in real scenario, parse vitest JSON output)
      const passed = !stderr && stdout.includes('PASS');
      
      results.push({
        module: module.name,
        passed,
      });
      
      if (passed) {
        console.log(`  ✅ ${module.name} - PASSED\n`);
      } else {
        console.log(`  ❌ ${module.name} - FAILED\n`);
      }
    } catch (error: any) {
      results.push({
        module: module.name,
        passed: false,
        error: error.message,
      });
      console.log(`  ❌ ${module.name} - ERROR: ${error.message}\n`);
    }
  }

  // Generate summary report
  console.log('\n📊 Test Summary\n');
  console.log('='.repeat(60));
  
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.length - passedCount;
  
  console.log(`Total Modules Tested: ${results.length}`);
  console.log(`✅ Passed: ${passedCount}`);
  console.log(`❌ Failed: ${failedCount}`);
  console.log('='.repeat(60));
  
  if (failedCount > 0) {
    console.log('\n⚠️  Failed Modules:\n');
    results
      .filter(r => !r.passed)
      .forEach(r => {
        console.log(`  ❌ ${r.module}`);
        if (r.error) {
          console.log(`     Error: ${r.error}`);
        }
      });
  }
  
  console.log('\n✅ All tests completed!\n');
}

// Run if executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

export { runTests };













