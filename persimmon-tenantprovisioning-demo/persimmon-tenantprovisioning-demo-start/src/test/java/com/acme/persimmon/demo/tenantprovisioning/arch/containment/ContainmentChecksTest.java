package com.acme.persimmon.demo.tenantprovisioning.arch.containment;

import static com.acme.persimmon.demo.tenantprovisioning.arch.support.ArchTestConstants.ROOT_PACKAGE;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

@AnalyzeClasses(packages = ROOT_PACKAGE, importOptions = ImportOption.DoNotIncludeTests.class)
public class ContainmentChecksTest {

  /**
   * Containment check: controllers belong to the web controller package.
   *
   * <p>Optional/Reserved: this is naming-convention based and can be tuned later.
   */
  @ArchTest
  static final ArchRule controllers_should_reside_in_web_controller_package =
      classes()
          .that()
          .haveSimpleNameEndingWith("Controller")
          .should()
          .resideInAPackage("..adapter.web..controller..")
          .allowEmptyShould(true)
          .because(
              "HTTP controllers should be placed under adapter.web.<bc>.controller for discoverability.");

  /**
   * Containment check: repository implementations belong to infra repository impl packages.
   *
   * <p>Optional/Reserved: adjust suffix/pattern to your implementation naming scheme.
   */
  @ArchTest
  static final ArchRule repository_impls_should_reside_in_infra_repository_impl_package =
      classes()
          .that()
          .haveSimpleNameEndingWith("RepositoryImpl")
          .should()
          .resideInAPackage("..infra.repository..impl..")
          .allowEmptyShould(true)
          .because("Repository implementations should be isolated in infra.repository.<bc>.impl.");

  /**
   * Containment check: application command handlers belong under app.<bc>.command.handler.
   *
   * <p>Optional/Reserved: this is a convention aligned with the DDD layout doc.
   */
  @ArchTest
  static final ArchRule command_handlers_should_reside_in_app_command_handler_package =
      classes()
          .that()
          .haveSimpleNameEndingWith("CommandHandler")
          .should()
          .resideInAPackage("..app..command.handler..")
          .allowEmptyShould(true)
          .because("Command handlers should be grouped under app.<bc>.command.handler.");
}
